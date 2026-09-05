/**
 * /api/column-coverage — "כמה מזה בכלל מלא?", asked BEFORE the dashboard exists.
 *
 * The wizard now shows the finite list of columns that could answer the
 * purpose (columnCandidates) instead of guessing one of them. This route puts
 * the second half of the honest sentence next to each option: how many rows
 * those boards hold, how many of them carry a value, and which boards carry
 * none at all.
 *
 * מיטל, 5.9: היא מדדה את זה ידנית ומצאה 286 מתוך 1,140 — 25%. בלי המספר הזה
 * הדשבורד מציג בית ספר שלא מילא כלום כאילו אף בוגר שם לא עושה דבר.
 *
 * Reads ONE column per candidate (fetchColumnFill), never the boards whole.
 * Nothing is written and nothing is saved: this route only measures.
 *
 * POST { candidates: [{ column, boardIds }] } → { coverage: ColumnCoverage[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireMonday } from "@/lib/monday-server";
import { fetchColumnFill } from "@/lib/board-fetch";
import { summarizeFill, type ColumnCoverage } from "@/lib/column-coverage";
import { CROSS_BOARD_MAX } from "@/lib/cross-board";
import { rateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many options the picker offers — and therefore how many we measure. */
const MAX_CANDIDATES = 6;
/** A ceiling on the whole request, so six candidates on ten boards each cannot
 *  turn one wizard step into sixty board reads. */
const MAX_BOARD_READS = 20;

export async function POST(req: NextRequest) {
  const guard = await requireMonday();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const rl = rateLimit("column-coverage", guard.orgId, 12, 60_000);
  if (!rl.ok)
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  const body = (await req.json().catch(() => ({}))) as { candidates?: unknown };
  const raw = Array.isArray(body.candidates) ? body.candidates : [];

  // Board ids arrive from the browser: numeric only, and capped at the number
  // a cross-board dashboard may actually be built from — so the percentage is
  // measured over exactly the boards that will be drawn.
  const candidates = raw
    .slice(0, MAX_CANDIDATES)
    .map((c) => {
      const o = (c ?? {}) as { column?: unknown; boardIds?: unknown };
      return {
        column: String(o.column ?? "").trim().slice(0, 120),
        boardIds: (Array.isArray(o.boardIds) ? o.boardIds : [])
          .map((x) => String(x).trim())
          .filter((x) => /^\d+$/.test(x))
          .slice(0, CROSS_BOARD_MAX),
      };
    })
    .filter((c) => c.column && c.boardIds.length);

  if (!candidates.length) return NextResponse.json({ coverage: [] });

  const out: ColumnCoverage[] = [];
  let budget = MAX_BOARD_READS;
  for (const c of candidates) {
    // Out of budget is not "0% full" — it is "not measured", and the screen
    // must be able to tell the two apart (הלקח הרביעי מ-5.9: כשמשהו נבנה
    // חלקית — לומר מה לא נבנה).
    if (budget <= 0) break;
    const ids = c.boardIds.slice(0, budget);
    budget -= ids.length;
    try {
      const { fills, missing } = await fetchColumnFill(ids, c.column, guard.token);
      out.push(summarizeFill(c.column, fills, c.boardIds.length, missing));
    } catch (e: unknown) {
      // One unreadable board must not cost the user the other options' numbers.
      console.warn("column-coverage failed for", c.column, e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json(
    { coverage: out },
    { headers: { "Cache-Control": "no-store" } }
  );
}
