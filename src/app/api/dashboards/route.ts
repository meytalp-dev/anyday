/**
 * /api/dashboards — the organization's saved dashboards (W3-4).
 *
 * A dashboard stops being an ephemeral view here: what the user approved in
 * the wizard is stored (title, their purpose verbatim, the widget spec) and
 * from now on the org owns SEVERAL — "דשבורד תורמים" next to "דשבורד תקציב".
 *
 * The spec is re-sanitized against the board's REAL profile at save time, so
 * even a tampered client cannot store a widget the board does not support.
 * Org comes from the session, never from the client. Viewer reads, never
 * writes — the wall is v6's RLS, the check here makes it a clear 403.
 *
 * GET  → { dashboards: [{ id, title, purpose, sourceRef, createdAt }] }
 * POST { boardId, title, purpose, spec } → { ok, id }
 */

import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/session";
import { createServiceClient, isSupabaseServerConfigured } from "@/lib/supabase-server";
import { requireMonday } from "@/lib/monday-server";
import { fetchBoards } from "@/lib/board-fetch";
import { profileBoard, applyPreferences } from "@/lib/board-profile";
import { readBoardPrefs } from "@/lib/board-prefs";
import { sanitizeSpec } from "@/lib/dashboard-spec";
import { fetchBoardMeta } from "@/lib/board-fetch";
import { matchStatusColumn } from "@/lib/cross-board";
import { BOARD_AXIS, resolveColumn } from "@/lib/slice";
import { rateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PURPOSE = 500;
const MAX_DASHBOARDS = 30;

function noStore(json: unknown, init?: { status?: number }) {
  return NextResponse.json(json, { ...init, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  if (!isSupabaseServerConfigured()) return noStore({ dashboards: [] });
  const ctx = await getOrgContext();
  if (!ctx) return noStore({ error: "יש להתחבר כדי להמשיך" }, { status: 401 });

  const service = createServiceClient();
  if (!service) return noStore({ error: "אחסון לא זמין" }, { status: 503 });

  const { data, error } = await service
    .from("dashboards")
    .select("id, title, purpose, source_ref, created_at")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(MAX_DASHBOARDS);
  // Before v6 the table does not exist — that is "no dashboards", not an error.
  if (error) return noStore({ dashboards: [] });

  return noStore({
    dashboards: (data ?? []).map((d) => ({
      id: d.id as string,
      title: d.title as string,
      purpose: (d.purpose as string) ?? "",
      sourceRef: (d.source_ref as string) ?? "",
      createdAt: d.created_at as string,
    })),
  });
}

export async function POST(req: NextRequest) {
  if (!isSupabaseServerConfigured())
    return noStore({ error: "שמירת דשבורד דורשת חשבון ארגוני (Supabase לא מוגדר)" }, { status: 503 });

  const ctx = await getOrgContext();
  if (!ctx) return noStore({ error: "יש להתחבר כדי להמשיך" }, { status: 401 });
  if (ctx.role === "viewer")
    return noStore({ error: "לצופה אין הרשאה ליצור דשבורד" }, { status: 403 });

  const rl = rateLimit("dashboards-write", ctx.orgId, 10, 60_000);
  if (!rl.ok) return noStore({ error: RATE_LIMIT_MESSAGE }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as {
    boardId?: unknown; boardIds?: unknown; title?: unknown; purpose?: unknown; spec?: unknown;
  };

  // ── cross-board dashboard (בקשת מיטל): one column, sliced across boards ──
  //
  // Two shapes reach here: the original crossBreakdown widget, and a slice
  // whose row axis is the board itself. Both need the same thing — the column
  // must really exist on at least two boards — so both are validated against
  // the boards' real columns before anything is stored.
  const specWidgets = (Array.isArray((body.spec as { widgets?: unknown[] })?.widgets)
    ? ((body.spec as { widgets: { kind?: unknown; col?: unknown; slice?: unknown }[] }).widgets)
    : []);
  const crossW = specWidgets.find((w) => w?.kind === "crossBreakdown");
  const crossSlice = specWidgets.find(
    (w) => w?.kind === "slice" && (w.slice as { rowCol?: unknown })?.rowCol === BOARD_AXIS
  );

  if (crossW || crossSlice) {
    const sl = (crossSlice?.slice ?? {}) as { colCol?: unknown; measure?: { col?: unknown } };
    // What must exist on each board: the cross column, or failing that the
    // measured column. A pure "count per board" needs neither.
    const colQuery = String(
      crossW ? crossW.col ?? "" : sl.colCol ?? sl.measure?.col ?? ""
    ).trim().slice(0, 120);
    const ids = (Array.isArray(body.boardIds) ? body.boardIds : [])
      .map((x) => String(x).trim())
      .filter((x) => /^\d+$/.test(x))
      .slice(0, 10);
    if (ids.length < 2)
      return noStore({ error: "חיתוך חוצה-לוחות דורש לפחות שני לוחות" }, { status: 400 });
    if (crossW && !colQuery)
      return noStore({ error: "חיתוך חוצה-לוחות דורש עמודה" }, { status: 400 });

    // Validate against the boards' REAL columns — columns only, no items.
    const guard = await requireMonday();
    if (!guard.ok) return noStore({ error: guard.error }, { status: guard.status });
    let meta;
    try {
      meta = await fetchBoardMeta(ids, guard.token);
    } catch (e: unknown) {
      return noStore({ error: e instanceof Error ? e.message : "שגיאה בקריאת הלוחות" }, { status: 502 });
    }
    // crossBreakdown only ever meant a status column; a slice may cross any type.
    const matched = colQuery
      ? meta.filter((b) => (crossW ? matchStatusColumn(b, colQuery) : resolveColumn(b, colQuery)))
      : meta;
    if (matched.length < 2)
      return noStore({ error: colQuery
        ? `עמודה שמתאימה ל"${colQuery}" נמצאה בפחות משני לוחות`
        : "פחות משני לוחות נמצאו" }, { status: 400 });

    const service = createServiceClient();
    if (!service) return noStore({ error: "אחסון לא זמין" }, { status: 503 });
    const fallbackTitle = colQuery ? `"${colQuery}" לפי לוח` : "פילוח לפי לוח";
    const title = String(body.title ?? "").trim().slice(0, 80) || fallbackTitle;
    const widgets = crossW
      ? [{ kind: "crossBreakdown", col: colQuery }]
      : [{ kind: "slice", slice: crossSlice!.slice }];
    const { data, error } = await service
      .from("dashboards")
      .insert({
        org_id: ctx.orgId,
        title,
        purpose: String(body.purpose ?? "").slice(0, MAX_PURPOSE),
        source_kind: "monday",
        source_ref: matched.map((b) => b.id).join(","),
        spec: { title, widgets },
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error || !data)
      return noStore({ error: `${error?.message ?? "השמירה נכשלה"} — ודאו ש-supabase-schema-v6.sql הורצה` }, { status: 502 });
    return noStore({ ok: true, id: data.id as string });
  }

  const boardId = String(body.boardId ?? "").trim();
  if (!/^\d+$/.test(boardId)) return noStore({ error: "חסר boardId" }, { status: 400 });

  // The save re-derives the profile and pushes the spec through it — the
  // browser's approval is a UX step, THIS is the validation.
  const guard = await requireMonday();
  if (!guard.ok) return noStore({ error: guard.error }, { status: guard.status });
  let boards;
  try {
    boards = await fetchBoards([boardId], guard.token);
  } catch (e: unknown) {
    return noStore({ error: e instanceof Error ? e.message : "שגיאה בקריאת הבורד" }, { status: 502 });
  }
  if (!boards.length) return noStore({ error: "הבורד לא נמצא או שאין הרשאה אליו" }, { status: 404 });

  const prefs = await readBoardPrefs(ctx.orgId, boardId);
  const profile = applyPreferences(profileBoard(boards[0]), prefs);
  const spec = sanitizeSpec(
    { title: body.title, widgets: (body.spec as { widgets?: unknown })?.widgets },
    profile
  );
  if (!spec.widgets.length)
    return noStore({ error: "לא נבחר אף רכיב שהלוח תומך בו" }, { status: 400 });

  const service = createServiceClient();
  if (!service) return noStore({ error: "אחסון לא זמין" }, { status: 503 });

  const { data, error } = await service
    .from("dashboards")
    .insert({
      org_id: ctx.orgId,
      title: spec.title,
      purpose: String(body.purpose ?? "").slice(0, MAX_PURPOSE),
      source_kind: "monday",
      source_ref: boardId,
      spec,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data)
    return noStore({ error: `${error?.message ?? "השמירה נכשלה"} — ודאו ש-supabase-schema-v6.sql הורצה` }, { status: 502 });

  return noStore({ ok: true, id: data.id as string });
}
