/**
 * /api/board-profile — the merged answer to "what matters on this board" (W2-3).
 *
 * Two voices, merged server-side:
 *   1. the deterministic engine (board-profile.ts): column ranking by type,
 *      fill and balance — what the STRUCTURE says matters;
 *   2. the org's saved preferences (board_preferences): what the PERSON said
 *      matters — and the person wins (applyPreferences).
 *
 * The result is exactly what the dashboard wizard's fixed prompt receives as
 * its data blocks (ב) and (ג): the AI may reorder within this profile, never
 * invent a column that is not in it. The board is read HERE, with the org's
 * own token — nothing arrives from the browser but board ids.
 *
 * GET ?boards=id,id (default: the saved selection cookie)
 *   → { profiles: [{ ...BoardProfile, prefs }], coverage }
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireMonday } from "@/lib/monday-server";
import { fetchBoards, parseBoardIds, coverage } from "@/lib/board-fetch";
import { profileBoard, applyPreferences } from "@/lib/board-profile";
import { readBoardPrefs } from "@/lib/board-prefs";
import { rateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await requireMonday();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const rl = rateLimit("board-profile", guard.orgId, 20, 60_000);
  if (!rl.ok)
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  const override = req.nextUrl.searchParams.get("boards");
  const saved = (await cookies()).get("anyday_selected_boards")?.value;
  const ids = parseBoardIds(override || saved);
  if (!ids.length) return NextResponse.json({ error: "בחרו בורד" }, { status: 400 });

  try {
    const boards = await fetchBoards(ids, guard.token);
    const profiles = await Promise.all(
      boards.map(async (b) => {
        const prefs = await readBoardPrefs(guard.orgId, b.id);
        return { ...applyPreferences(profileBoard(b), prefs), prefs };
      })
    );
    return NextResponse.json({ profiles, coverage: coverage(boards) });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאה" }, { status: 502 });
  }
}
