// Cross-board slicing (בקשת מיטל 1.9): the aggregate board has no "סטטוס
// טיפול" column, but every school's own board carries a local variant of it.
// This module reads that column FROM EACH BOARD — found by the same flexible
// matching the rest of the product uses, so "סטטוס טיפול (מילויי צוות)" on one
// board and "סטטוס טיפול" on another are the same ask — and aggregates the
// per-board breakdowns into one widget: the status, sliced by board (= by
// school). Zero new analysis: each group is BI.breakdown of its own board,
// each tone comes from that board's own label colours. Boards that lack the
// column are skipped AND named — a slice that silently omits a school lies.

import * as BI from "./board-intelligence";
import type { Board, Col, Widget, Tone } from "./board-intelligence";
import { columnMentioned } from "./board-profile";

/**
 * How many boards one cross-board dashboard may read.
 *
 * It lives here rather than as a literal in each route because THREE places
 * have to agree on it: the save (which boards are stored), the render (which
 * boards are read back), and the wizard (which must say out loud when a
 * candidate is on more boards than this — a school dropped in silence is
 * exactly the failure this whole screen exists to prevent).
 */
export const CROSS_BOARD_MAX = 10;

const STATUS_TYPES = ["status", "color", "dropdown"];

/** This board's own version of the asked-for column, or null — never a guess. */
export function matchStatusColumn(board: Board, colQuery: string): Col | null {
  return (
    board.columns.find(
      (c) => STATUS_TYPES.includes(c.type) && columnMentioned(c.title, colQuery)
    ) ?? null
  );
}

export interface CrossGroup {
  boardId: string;
  boardName: string;
  /** The column's LOCAL title on this board. */
  colTitle: string;
  total: number;
  rows: { label: string; n: number; tone: Tone }[];
}

export interface CrossBreakdownData {
  groups: CrossGroup[];
  /** Boards that lack a matching column — named, never silently dropped. */
  skipped: string[];
}

export function crossBreakdown(boards: Board[], colQuery: string): Widget | null {
  const groups: CrossGroup[] = [];
  const skipped: string[] = [];

  for (const b of boards) {
    const col = matchStatusColumn(b, colQuery);
    if (!col) { skipped.push(b.name); continue; }
    const w = BI.breakdown(b, col.title);
    if (!w) { skipped.push(b.name); continue; }
    const d = w.data as { rows: { label: string; n: number; tone: Tone }[]; total: number };
    groups.push({ boardId: b.id, boardName: b.name, colTitle: col.title, total: d.total, rows: d.rows });
  }

  if (!groups.length) return null;
  return {
    kind: "crossBreakdown",
    title: `"${colQuery}" לפי לוח`,
    source: `${groups.length} לוחות${skipped.length ? ` · ${skipped.length} לוחות בלי העמודה` : ""}`,
    data: { groups, skipped } satisfies CrossBreakdownData,
  };
}
