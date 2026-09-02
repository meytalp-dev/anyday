import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireMonday } from "@/lib/monday-server";
import { fetchBoards, fetchBoardMeta, parseBoardIds, coverage } from "@/lib/board-fetch";
import * as BI from "@/lib/board-intelligence";
import { readBoardPrefs } from "@/lib/board-prefs";
import { buildLiveBoard } from "@/lib/live-board";

/**
 * Smart dashboard data for one or more boards. Generic (works by column TYPE),
 * so it produces a rich, real dashboard for ANY nonprofit's board:
 *  - headline KPIs (total, at-risk, stale, completed-share)
 *  - every status column as a breakdown chart
 *  - owner distribution, number summaries, attention list
 * Accepts ?boards=id,id to override the saved selection (right-rail picker).
 * Items are read with pagination, and the response says how much of the board
 * the numbers actually cover.
 *
 * Two extra fields, both language-independent:
 *  - `tones`: every status value on the board -> "risk" | "progress" | "done" |
 *    "neutral", derived from the HUE of the colour the board itself gave that
 *    label. The browser paints by this and therefore knows no words.
 *  - each breakdown row already carries its own `tone` (see board-intelligence).
 *
 * `?meta=1` is a cheap columns-only mode (no items at all): it returns just
 * `tones` + `entities`, for screens that need to colour a chip or name a row
 * without pulling the whole board again.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMonday();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const override = req.nextUrl.searchParams.get("boards");
  const saved = (await cookies()).get("anyday_selected_boards")?.value;
  const ids = parseBoardIds(override || saved);
  if (!ids.length) return NextResponse.json({ error: "בחרו בורד" }, { status: 400 });

  // Columns-only mode: the tone map + the board's own word for a row. No items.
  if (req.nextUrl.searchParams.get("meta") === "1") {
    try {
      const metaBoards = await fetchBoardMeta(ids, guard.token);
      const tones: Record<string, string> = {};
      const entities: Record<string, string> = {};
      for (const b of metaBoards) {
        Object.assign(tones, BI.statusTones(b));
        entities[b.name] = BI.terminology(b).entityPlural;
      }
      return NextResponse.json({ tones, entities, boardNames: metaBoards.map((b) => b.name) });
    } catch (e: unknown) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאה" }, { status: 502 });
    }
  }

  try {
    const biBoards = await fetchBoards(ids, guard.token);

    // The whole computation lives in lib/live-board so the sheet screen can run
    // exactly the same thing in the browser (בקשת מיטל 2.9). This route's only
    // remaining job is to fetch the boards and read the saved preferences.
    const inputs = await Promise.all(
      biBoards.map(async (b) => ({ board: b, prefs: await readBoardPrefs(guard.orgId, b.id) }))
    );
    const live = buildLiveBoard(inputs);

    return NextResponse.json({ ...live, coverage: coverage(biBoards) });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאה" }, { status: 502 });
  }
}
