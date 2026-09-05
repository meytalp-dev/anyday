// How full is this column, really — measured before the dashboard is built.
//
// מיטל, 5.9: היא גילתה **ידנית** ש"מה עושה היום" מלאה ב-25% בלבד (286 מתוך
// 1,140), ושבשניים מהלוחות היא 0 ו-2. בלי המספר הזה, הדשבורד מציג את "עתיד
// קריית מוצקין" כאילו אף בוגר שם לא עושה כלום — במקום "לא נאסף". זה ההבדל בין
// מספרים לבין משהו שסומכים עליו בישיבת הנהלה.
//
// This module is the arithmetic only: what "filled" means, how the per-board
// numbers add up, and — the part that matters — what the summary must ADMIT
// when the measurement did not cover everything. Reading the values from
// Monday is board-fetch's job (fetchColumnFill); nothing here touches the API,
// so every rule below is testable without a token.

/** One board's answer, as measured. */
export interface BoardFill {
  boardId: string;
  boardName: string;
  /** The board's LOCAL spelling of the column we measured. */
  colTitle: string;
  /** Rows we actually read. */
  rows: number;
  /** Of those, how many carry any value. */
  filled: number;
  /** The board's real row total, as Monday reports it. */
  itemsCount: number;
}

export interface ColumnCoverage {
  column: string;
  /** Rows read across every measured board. */
  rows: number;
  filled: number;
  /** 0-100, over `rows`. */
  fillPct: number;
  perBoard: (BoardFill & { fillPct: number })[];
  /** Boards where not one row carries a value — "לא נאסף", not "אף אחד". */
  emptyBoards: string[];
  /** Boards asked for, boards measured, boards that had no such column. */
  boardsAsked: number;
  boardsMeasured: number;
  missingBoards: string[];
  /** True when some board held more rows than we read — the % is a sample. */
  truncated: boolean;
}

/** Non-empty after trimming. Monday returns "" and null for an unset cell. */
export const isFilled = (text: string | null | undefined): boolean => Boolean((text ?? "").trim());

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

/**
 * Fold the per-board measurements into the one line the wizard shows.
 *
 * `boardsAsked` and `missing` are parameters rather than derived, because the
 * summary's job includes saying what was NOT measured. A blanket condition on
 * the whole hides a failure in a part (הלקח הרביעי מ-5.9): a percentage that
 * quietly averages eight boards while the label says eleven is precisely the
 * kind of number that survives until a management meeting.
 */
export function summarizeFill(
  column: string,
  perBoard: BoardFill[],
  boardsAsked: number,
  missingBoards: string[] = []
): ColumnCoverage {
  const rows = perBoard.reduce((s, b) => s + b.rows, 0);
  const filled = perBoard.reduce((s, b) => s + b.filled, 0);
  return {
    column,
    rows,
    filled,
    fillPct: pct(filled, rows),
    perBoard: perBoard.map((b) => ({ ...b, fillPct: pct(b.filled, b.rows) })),
    // A board with no rows at all is not a board with an empty column: there is
    // nothing there to have filled in, and calling it "ריק" would send someone
    // to chase data that was never expected.
    emptyBoards: perBoard.filter((b) => b.rows > 0 && b.filled === 0).map((b) => b.boardName),
    boardsAsked,
    boardsMeasured: perBoard.length,
    missingBoards,
    truncated: perBoard.some((b) => b.rows < b.itemsCount),
  };
}

/* ------------------------------------------------------- the sentences shown */

const num = (n: number) => n.toLocaleString("he-IL");

/**
 * What is known about a candidate for FREE — boards and rows, both from
 * Monday's own counters. No row is read to produce this line, so it can be
 * shown the instant the candidate list arrives.
 *
 * `max` is the number of boards a cross-board dashboard may actually read, and
 * it is not decoration: past it, the headline describes boards that will never
 * be drawn. A candidate on eleven boards then reads "11 לוחות · 1,240 שורות"
 * above a measurement of ten of them — two row counts side by side, neither of
 * them the dashboard's. So the line counts what will be built, and says so.
 */
export function candidateFacts(c: { boards: { rows: number }[]; rows: number }, max = Infinity): string {
  const n = c.boards.length;
  if (n > max) {
    const rows = c.boards.slice(0, max).reduce((s, b) => s + b.rows, 0);
    return `${num(max)} מתוך ${num(n)} לוחות · ${num(rows)} שורות`;
  }
  return `${n === 1 ? "לוח אחד" : `${num(n)} לוחות`} · ${num(c.rows)} שורות`;
}

/**
 * And what had to be measured: how much of it is actually filled.
 *
 * Everything the measurement did NOT cover is said in the same breath as the
 * percentage, never after it. A number that quietly averages eight boards
 * while the label above it says eleven is the kind that survives all the way
 * to a management meeting (הלקח הרביעי מ-5.9).
 */
export function fillLine(cov: ColumnCoverage | undefined, loading: boolean): string {
  if (!cov) return loading ? "בודקים כמה מזה מלא…" : "";
  const parts = [`מלא ב-${cov.fillPct}% (${num(cov.filled)} מתוך ${num(cov.rows)})`];
  if (cov.boardsMeasured < cov.boardsAsked)
    parts.push(`נמדדו ${cov.boardsMeasured} מתוך ${cov.boardsAsked} לוחות`);
  if (cov.truncated) parts.push("מדגם");
  return parts.join(" · ");
}
