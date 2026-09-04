/**
 * /api/sheet-sources — saving a spreadsheet, so a dashboard built from it can
 * keep working when nobody is looking (הכרעת מיטל 4.9).
 *
 * ── The line this route draws ───────────────────────────────────────────────
 * Browsing /sheet stores nothing and needs no account: a file is read, charted
 * and forgotten in the tab. This route is the other side of that line. Calling
 * it means a person deliberately chose to SAVE, was told the data would be
 * stored, and has an organisation to store it against. That is why it requires
 * a session where the rest of /sheet requires none.
 *
 * ── What arrives ────────────────────────────────────────────────────────────
 * The sheet's raw text and the type corrections the user made — never parsed
 * rows, so the system keeps exactly one parser. A 'link' source also carries
 * its URL, checked against the same SSRF rule that guards the live fetch: a
 * link we would refuse to READ is a link we refuse to STORE, because a
 * scheduler will follow it later with nobody watching.
 *
 * POST { title, kind, csv, url?, typeOverrides? } → { ok, id }
 * GET  → { sources: [{ id, title, kind, rows, fetchedAt }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/session";
import { createServiceClient, isSupabaseServerConfigured } from "@/lib/supabase-server";
import { sanitizeSheetSource, sourceToBoard } from "@/lib/sheet-source";
import { rateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SOURCES = 20;

function noStore(json: unknown, init?: { status?: number }) {
  return NextResponse.json(json, { ...init, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  if (!isSupabaseServerConfigured()) return noStore({ sources: [] });
  const ctx = await getOrgContext();
  if (!ctx) return noStore({ error: "יש להתחבר כדי להמשיך" }, { status: 401 });

  const service = createServiceClient();
  if (!service) return noStore({ error: "אחסון לא זמין" }, { status: 503 });

  const { data, error } = await service
    .from("sheet_sources")
    .select("id, title, kind, fetched_at, created_at")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(MAX_SOURCES);
  // Before v7 the table does not exist — that is "no sources", not an error.
  if (error) return noStore({ sources: [] });

  return noStore({
    sources: (data ?? []).map((d) => ({
      id: d.id as string,
      title: d.title as string,
      kind: d.kind as string,
      fetchedAt: d.fetched_at as string,
    })),
  });
}

export async function POST(req: NextRequest) {
  if (!isSupabaseServerConfigured())
    return noStore({ error: "שמירת גיליון דורשת חשבון ארגוני (Supabase לא מוגדר)" }, { status: 503 });

  const ctx = await getOrgContext();
  if (!ctx) return noStore({ error: "יש להתחבר כדי לשמור גיליון" }, { status: 401 });
  if (ctx.role === "viewer")
    return noStore({ error: "לצופה אין הרשאה לשמור גיליון" }, { status: 403 });

  // Each call stores up to 2MB, so the ceiling is tighter than the read routes'.
  const rl = rateLimit("sheet-sources-write", ctx.orgId, 5, 60_000);
  if (!rl.ok) return noStore({ error: RATE_LIMIT_MESSAGE }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const clean = sanitizeSheetSource(body);
  if (!clean)
    return noStore(
      { error: "הגיליון לא נשמר: צריך תוכן, סוג מקור תקין, ולקישור — כתובת Google Sheets תקינה (עד 2MB)." },
      { status: 400 }
    );

  // Prove it parses into something before storing it. A source that cannot
  // become a board is a row that will fail silently inside a 5am email.
  const board = sourceToBoard(clean);
  if (!board || !board.items.length)
    return noStore({ error: "לא נמצאו שורות בגיליון." }, { status: 400 });

  const service = createServiceClient();
  if (!service) return noStore({ error: "אחסון לא זמין" }, { status: 503 });

  const { count } = await service
    .from("sheet_sources")
    .select("id", { count: "exact", head: true })
    .eq("org_id", ctx.orgId);
  if ((count ?? 0) >= MAX_SOURCES)
    return noStore({ error: `אפשר לשמור עד ${MAX_SOURCES} גיליונות. מחקו אחד קודם.` }, { status: 400 });

  const { data, error } = await service
    .from("sheet_sources")
    .insert({
      org_id: ctx.orgId,
      title: clean.title,
      kind: clean.kind,
      url: clean.url ?? null,
      csv: clean.csv,
      type_overrides: clean.typeOverrides ?? {},
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data)
    return noStore({ error: `${error?.message ?? "השמירה נכשלה"} — ודאו ש-supabase-schema-v7.sql הורצה` }, { status: 502 });

  return noStore({ ok: true, id: data.id as string, rows: board.items.length });
}
