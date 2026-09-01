/**
 * /api/board-prefs — "מה חשוב לך בלוח הזה", per org + board (W2-1).
 *
 * This is the user's half of the profile: the engine (board-profile.ts) works
 * out what the STRUCTURE says matters; this table records what the PERSON says
 * matters, and applyPreferences() lets the person win. It is also where
 * calibration will live (tone_overrides, muted insights) — the answer to the
 * review's trust finding: a product that interprets must be correctable.
 *
 * Scoped to the caller's own org from the session; an org id is never accepted
 * from the client. Writing follows the v6 RLS shape (admin+member, not viewer)
 * — the role check here exists so refusal is a clear 403, the wall is RLS.
 *
 * GET  ?board=<id>          → { prefs, editable }
 * POST { boardId, prefs }   → save (whole-document overwrite, sanitized)
 */

import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/session";
import { createServiceClient, isSupabaseServerConfigured } from "@/lib/supabase-server";
import { rateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { sanitizePrefs, readBoardPrefs } from "@/lib/board-prefs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(json: unknown, init?: { status?: number }) {
  return NextResponse.json(json, { ...init, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const board = (req.nextUrl.searchParams.get("board") || "").trim();
  if (!/^\d+$/.test(board)) return noStore({ error: "חסר board" }, { status: 400 });

  if (!isSupabaseServerConfigured()) return noStore({ prefs: {}, editable: false });
  const ctx = await getOrgContext();
  if (!ctx) return noStore({ error: "יש להתחבר כדי להמשיך" }, { status: 401 });

  const prefs = await readBoardPrefs(ctx.orgId, board);
  return noStore({ prefs, editable: ctx.role !== "viewer" });
}

export async function POST(req: NextRequest) {
  if (!isSupabaseServerConfigured())
    return noStore({ error: "שמירת העדפות דורשת חשבון ארגוני (Supabase לא מוגדר)" }, { status: 503 });

  const ctx = await getOrgContext();
  if (!ctx) return noStore({ error: "יש להתחבר כדי להמשיך" }, { status: 401 });
  if (ctx.role === "viewer")
    return noStore({ error: "לצופה אין הרשאה לשנות את ההעדפות" }, { status: 403 });

  const rl = rateLimit("board-prefs", ctx.orgId, 20, 60_000);
  if (!rl.ok) return noStore({ error: RATE_LIMIT_MESSAGE }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { boardId?: unknown; prefs?: unknown };
  const boardId = String(body.boardId ?? "").trim();
  if (!/^\d+$/.test(boardId)) return noStore({ error: "חסר boardId" }, { status: 400 });

  const prefs = sanitizePrefs(body.prefs);

  const service = createServiceClient();
  if (!service) return noStore({ error: "אחסון לא זמין" }, { status: 503 });

  const { error } = await service
    .from("board_preferences")
    .upsert(
      { org_id: ctx.orgId, source_ref: boardId, prefs },
      { onConflict: "org_id,source_ref" }
    );
  if (error)
    return noStore({ error: `${error.message} — ודאו ש-supabase-schema-v6.sql הורצה` }, { status: 502 });

  return noStore({ ok: true, prefs });
}
