/**
 * /api/dashboards/[id] — render or delete ONE saved dashboard.
 *
 * GET reads the org's own row, then computes every widget LIVE from Monday
 * through the one engine (dashboard-compute): a saved dashboard stores the
 * QUESTIONS, never yesterday's answers. A widget whose column has since been
 * deleted is skipped silently — the dashboard keeps rendering what it can.
 *
 * DELETE is writer-only (viewer gets a clear 403; the wall is v6's RLS).
 * Both are scoped by org_id from the session — a dashboard id from another
 * tenant answers 404, indistinguishable from "never existed".
 */

import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/session";
import { createServiceClient, isSupabaseServerConfigured } from "@/lib/supabase-server";
import { requireMonday } from "@/lib/monday-server";
import { fetchBoards, parseBoardIds, coverage } from "@/lib/board-fetch";
import { computeSpecWidgets } from "@/lib/dashboard-compute";
import { statusTones, type Widget } from "@/lib/board-intelligence";
import type { DashboardSpec } from "@/lib/dashboard-spec";
import { rateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function noStore(json: unknown, init?: { status?: number }) {
  return NextResponse.json(json, { ...init, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return noStore({ error: "מזהה לא תקין" }, { status: 400 });

  if (!isSupabaseServerConfigured()) return noStore({ error: "Supabase לא מוגדר" }, { status: 503 });
  const ctx = await getOrgContext();
  if (!ctx) return noStore({ error: "יש להתחבר כדי להמשיך" }, { status: 401 });

  const rl = rateLimit("dashboards-view", ctx.orgId, 30, 60_000);
  if (!rl.ok) return noStore({ error: RATE_LIMIT_MESSAGE }, { status: 429 });

  const service = createServiceClient();
  if (!service) return noStore({ error: "אחסון לא זמין" }, { status: 503 });

  const { data, error } = await service
    .from("dashboards")
    .select("title, purpose, source_ref, spec")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (error || !data) return noStore({ error: "הדשבורד לא נמצא" }, { status: 404 });

  const guard = await requireMonday();
  if (!guard.ok) return noStore({ error: guard.error }, { status: guard.status });

  // source_ref is one board id — or a csv of several, for a cross-board
  // dashboard (בקשת מיטל: "סטטוס טיפול" מכל לוחות בתי הספר יחד).
  const ids = parseBoardIds(String(data.source_ref), 10);
  let boards;
  try {
    boards = await fetchBoards(ids, guard.token);
  } catch (e: unknown) {
    return noStore({ error: e instanceof Error ? e.message : "שגיאה בקריאת הבורד" }, { status: 502 });
  }
  if (!boards.length)
    return noStore({ error: "בורד המקור לא נמצא ב-Monday או שאין אליו הרשאה" }, { status: 404 });

  // One call for every widget kind: single-board widgets read the first board,
  // cross-board slices read them all, and the old crossBreakdown shape still
  // renders for dashboards saved before the slice engine.
  const spec = data.spec as DashboardSpec;
  const widgets: Widget[] = computeSpecWidgets(boards, spec);

  const tones: Record<string, string> = {};
  for (const b of boards) Object.assign(tones, statusTones(b));

  return noStore({
    title: data.title as string,
    purpose: (data.purpose as string) ?? "",
    boardName: boards.map((b) => b.name).join(" · "),
    widgets,
    tones,
    coverage: coverage(boards),
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return noStore({ error: "מזהה לא תקין" }, { status: 400 });

  if (!isSupabaseServerConfigured()) return noStore({ error: "Supabase לא מוגדר" }, { status: 503 });
  const ctx = await getOrgContext();
  if (!ctx) return noStore({ error: "יש להתחבר כדי להמשיך" }, { status: 401 });
  if (ctx.role === "viewer")
    return noStore({ error: "לצופה אין הרשאה למחוק דשבורד" }, { status: 403 });

  const service = createServiceClient();
  if (!service) return noStore({ error: "אחסון לא זמין" }, { status: 503 });

  const { error } = await service
    .from("dashboards")
    .delete()
    .eq("id", id)
    .eq("org_id", ctx.orgId);
  if (error) return noStore({ error: error.message }, { status: 502 });

  return noStore({ ok: true });
}
