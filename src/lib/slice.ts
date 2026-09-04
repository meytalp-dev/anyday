// The generic slice engine (בקשת מיטל 2.9: "חיתוכים שונים של כל מיני פרמטרים").
//
// Until now every widget was its own function: breakdown by status, split by
// owner, summary of a number. Each one-dimensional, each locked to one column
// type. "Everything must be open" is one generic request instead:
//
//     group by X · cross with Y · measure Z · only where F
//
// Everything falls out of that. A plain breakdown is a request with no Y. A
// cross-tab is a request with Y. A cross-board slice is a request where the
// BOARD itself is the axis. There are no special cases in the code, and that
// is precisely why there is no limit to what a customer can ask for.
//
// The engine is pure and takes `Board` only, so it behaves identically on a
// Monday board and on an uploaded spreadsheet (`planToBoard` produces the same
// shape) — with no extra logic for either.

import { valueOf, parseBoardDate, type Board, type Col, type Item, type Widget } from "./board-intelligence";
import { bucketOf, columnMentioned, hasSignal, profileBoard } from "./board-profile";
import { bucketizeValues, EMPTY_KEY, OTHER_KEY, type BucketKey } from "./slice-buckets";

/** Sentinel axis: "group by which board this row came from". Structural, not a word. */
export const BOARD_AXIS = "__board__";

export type Agg = "count" | "sum" | "avg" | "min" | "max";
export type FilterOp = "is" | "isNot" | "contains" | "gt" | "lt" | "between" | "isEmpty" | "notEmpty";

export interface SliceFilter {
  col: string;
  op: FilterOp;
  value?: string;
  /** Upper bound, for `between` only. */
  value2?: string;
}

export interface SliceMeasure {
  col: string;
  agg: Agg;
}

export interface SliceSpec {
  /** What groups the rows. May be BOARD_AXIS in a cross-board slice. */
  rowCol: string;
  /** What cuts across, giving a two-dimensional table. Absent = a plain list. */
  colCol?: string;
  /** What the numbers mean. Absent = count of records. */
  measure?: SliceMeasure;
  /** Narrow the base before grouping. All filters must pass (and, not or). */
  filters?: SliceFilter[];
}

export interface SliceResult {
  rowKeys: BucketKey[];
  /** Empty in a one-dimensional slice. */
  colKeys: BucketKey[];
  /** cells[rowIndex][colIndex]; a 1-D slice has exactly one column. */
  cells: number[][];
  rowTotals: number[];
  colTotals: number[];
  grandTotal: number;
  /** Human label for what the numbers are, so the screen never has to guess. */
  measureLabel: string;
  /** Records left after filters, and how many there were before. */
  matched: number;
  ofTotal: number;
  /** Boards named but skipped for lacking the column. Cross-board only. */
  skipped: string[];
}

/** Beyond these a table stops being readable; the tail folds into "other". */
const MAX_ROWS = 20;
const MAX_COLS = 12;

/* ------------------------------------------------------------ resolution */

/**
 * This board's version of a requested column: the exact title first, then the
 * same flexible matching the rest of the product uses, so "סטטוס טיפול
 * (מילויי צוות)" on one board answers a request for "סטטוס טיפול". Never a
 * guess beyond that — an unmatched request returns null and the caller says so.
 */
export function resolveColumn(board: Board, query: string): Col | null {
  if (!query) return null;
  const exact = board.columns.find((c) => c.title === query);
  if (exact) return exact;
  return board.columns.find((c) => columnMentioned(c.title, query)) ?? null;
}

const isNumberCol = (c: Col) => bucketOf(c.type) === "number";

/* ---------------------------------------------------------------- filters */

function numOf(text: string): number | null {
  if (!text) return null;
  const n = Number(text.replace(/[,\s₪$€]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Compare as numbers when both sides are numeric, as dates when both parse, else as text. */
function compare(cell: string, value: string): number | null {
  const a = numOf(cell), b = numOf(value);
  if (a !== null && b !== null) return a - b;
  const da = parseBoardDate(cell), db = parseBoardDate(value);
  if (da && db) return da.at - db.at;
  return cell.localeCompare(value, "he");
}

function passes(item: Item, board: Board, f: SliceFilter): boolean {
  const col = resolveColumn(board, f.col);
  // A filter on a column this board does not have is dropped, not treated as
  // "nothing matches": silently emptying a dashboard is worse than ignoring it.
  if (!col) return true;
  const cell = valueOf(item, col).trim();
  const v = (f.value ?? "").trim();

  switch (f.op) {
    case "isEmpty":  return !cell;
    case "notEmpty": return !!cell;
    case "is":       return cell === v;
    case "isNot":    return cell !== v;
    case "contains": return cell.includes(v);
    case "gt":       { const c = compare(cell, v); return c !== null && c > 0; }
    case "lt":       { const c = compare(cell, v); return c !== null && c < 0; }
    case "between":  {
      const lo = compare(cell, v);
      const hi = compare(cell, (f.value2 ?? "").trim());
      return lo !== null && hi !== null && lo >= 0 && hi <= 0;
    }
    default: return true;
  }
}

function applyFilters(board: Board, items: Item[], filters?: SliceFilter[]): Item[] {
  if (!filters?.length) return items;
  return items.filter((it) => filters.every((f) => passes(it, board, f)));
}

/* ------------------------------------------------------------ aggregation */

interface Acc { n: number; nv: number; sum: number; min: number; max: number }
const newAcc = (): Acc => ({ n: 0, nv: 0, sum: 0, min: Infinity, max: -Infinity });

function push(a: Acc, v: number | null): void {
  a.n++;
  if (v === null) return;
  a.nv++;
  a.sum += v;
  if (v < a.min) a.min = v;
  if (v > a.max) a.max = v;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function finalize(a: Acc, agg: Agg): number {
  switch (agg) {
    case "count": return a.n;
    case "sum":   return round2(a.sum);
    case "avg":   return a.nv ? round2(a.sum / a.nv) : 0;
    case "min":   return a.nv ? a.min : 0;
    case "max":   return a.nv ? a.max : 0;
  }
}

const AGG_WORD: Record<Agg, string> = {
  count: "מספר רשומות", sum: "סכום", avg: "ממוצע", min: "מינימום", max: "מקסימום",
};

function measureLabelOf(measure?: SliceMeasure): string {
  if (!measure || measure.agg === "count") return AGG_WORD.count;
  return `${AGG_WORD[measure.agg]} "${measure.col}"`;
}

/* ---------------------------------------------------------- the core grid */

/** One board's contribution to a slice: which axis keys each row belongs to. */
interface Contribution {
  rowKeys: string[];
  colKeys: string[];
  value: number | null;
}

function buildGrid(
  contributions: Contribution[],
  rowOrder: BucketKey[],
  colOrder: BucketKey[],
  agg: Agg,
): { cells: number[][]; rowTotals: number[]; colTotals: number[]; grandTotal: number } {
  const rowIdx = new Map(rowOrder.map((k, i) => [k.key, i]));
  const colIdx = new Map(colOrder.map((k, i) => [k.key, i]));
  const nCols = Math.max(colOrder.length, 1);

  const cellAcc = rowOrder.map(() => Array.from({ length: nCols }, newAcc));
  const rowAcc = rowOrder.map(newAcc);
  const colAcc = Array.from({ length: nCols }, newAcc);
  const grand = newAcc();

  for (const c of contributions) {
    for (const rk of c.rowKeys) {
      const ri = rowIdx.get(rk);
      if (ri === undefined) continue;
      push(rowAcc[ri], c.value);
      const cks = colOrder.length ? c.colKeys : [""];
      for (const ck of cks) {
        const ci = colOrder.length ? colIdx.get(ck) : 0;
        if (ci === undefined) continue;
        push(cellAcc[ri][ci], c.value);
        push(colAcc[ci], c.value);
        push(grand, c.value);
      }
    }
  }

  return {
    cells: cellAcc.map((r) => r.map((a) => finalize(a, agg))),
    rowTotals: rowAcc.map((a) => finalize(a, agg)),
    colTotals: colAcc.map((a) => finalize(a, agg)),
    grandTotal: finalize(grand, agg),
  };
}

/**
 * Fold a too-long axis into "other" so the table stays readable, without
 * losing a single record. Frequency-ordered axes keep their biggest members;
 * naturally-ordered ones (ranges, dates) keep their head, because reordering
 * a timeline by size would make it meaningless.
 */
function capAxis(keys: BucketKey[], max: number, natural: boolean, weight: (k: BucketKey) => number): {
  keys: BucketKey[];
  remap: Map<string, string>;
} {
  const remap = new Map<string, string>();
  if (keys.length <= max) return { keys, remap };

  const ranked = natural ? keys : [...keys].sort((a, b) => weight(b) - weight(a));
  const kept = new Set(ranked.slice(0, max - 1).map((k) => k.key));
  for (const k of keys) if (!kept.has(k.key)) remap.set(k.key, OTHER_KEY);

  const out = keys.filter((k) => kept.has(k.key));
  out.push({ key: OTHER_KEY, tone: "neutral", sort: Number.MAX_SAFE_INTEGER });
  return { keys: out, remap };
}

const remapKeys = (ks: string[], remap: Map<string, string>) =>
  remap.size ? [...new Set(ks.map((k) => remap.get(k) ?? k))] : ks;

/* ---------------------------------------------------------- single board */

/**
 * Slice one board. Returns null — never an empty-looking table — when the
 * request cannot be honoured: a column the board does not have, a measure on
 * something that is not a number, or a table of a column against itself.
 */
export function sliceBoard(board: Board, spec: SliceSpec): SliceResult | null {
  const rowCol = resolveColumn(board, spec.rowCol);
  if (!rowCol) return null;

  const colCol = spec.colCol ? resolveColumn(board, spec.colCol) : null;
  if (spec.colCol && !colCol) return null;
  // A column crossed with itself is a diagonal, not a finding.
  if (colCol && colCol.id === rowCol.id) return null;

  const measureCol = spec.measure ? resolveColumn(board, spec.measure.col) : null;
  if (spec.measure && spec.measure.agg !== "count") {
    if (!measureCol || !isNumberCol(measureCol)) return null;
  }
  const agg: Agg = spec.measure?.agg ?? "count";

  const items = applyFilters(board, board.items, spec.filters);

  const rowB = bucketizeValues(rowCol, items.map((it) => valueOf(it, rowCol)));
  const colB = colCol ? bucketizeValues(colCol, items.map((it) => valueOf(it, colCol))) : null;

  // Weight for capping = how many records land in that key.
  const rowWeight = new Map<string, number>();
  const colWeight = new Map<string, number>();
  for (const it of items) {
    for (const k of rowB.keyOf(valueOf(it, rowCol))) rowWeight.set(k, (rowWeight.get(k) ?? 0) + 1);
    if (colB && colCol) for (const k of colB.keyOf(valueOf(it, colCol))) colWeight.set(k, (colWeight.get(k) ?? 0) + 1);
  }

  const rowNatural = rowB.mode === "number" || rowB.mode === "date";
  const colNatural = !!colB && (colB.mode === "number" || colB.mode === "date");
  const rowCap = capAxis(rowB.keys, MAX_ROWS, rowNatural, (k) => rowWeight.get(k.key) ?? 0);
  const colCap = colB ? capAxis(colB.keys, MAX_COLS, colNatural, (k) => colWeight.get(k.key) ?? 0) : { keys: [], remap: new Map<string, string>() };

  const contributions: Contribution[] = items.map((it) => ({
    rowKeys: remapKeys(rowB.keyOf(valueOf(it, rowCol)), rowCap.remap),
    colKeys: colB && colCol ? remapKeys(colB.keyOf(valueOf(it, colCol)), colCap.remap) : [],
    value: measureCol ? numOf(valueOf(it, measureCol)) : null,
  }));

  const grid = buildGrid(contributions, rowCap.keys, colCap.keys, agg);

  return {
    rowKeys: rowCap.keys,
    colKeys: colCap.keys,
    ...grid,
    measureLabel: measureLabelOf(spec.measure),
    matched: items.length,
    ofTotal: board.items.length,
    skipped: [],
  };
}

/* ----------------------------------------------------------- cross-board */

/**
 * Slice with the BOARD as the row axis — "status per school", where each
 * school is its own board. Each board's local version of the column is found
 * by the same flexible matching, and the values are POOLED before bucketing so
 * every board's numbers land in the same ranges.
 *
 * A board that lacks the column is named in `skipped`, never silently dropped:
 * a slice that quietly omits a school is a lie about that school.
 */
export function sliceBoards(boards: Board[], spec: SliceSpec): SliceResult | null {
  if (spec.rowCol !== BOARD_AXIS) {
    return boards[0] ? sliceBoard(boards[0], spec) : null;
  }

  const agg: Agg = spec.measure?.agg ?? "count";
  const skipped: string[] = [];
  const usable: { board: Board; items: Item[]; colCol: Col | null; measureCol: Col | null }[] = [];

  for (const b of boards) {
    const colCol = spec.colCol ? resolveColumn(b, spec.colCol) : null;
    if (spec.colCol && !colCol) { skipped.push(b.name); continue; }

    const measureCol = spec.measure ? resolveColumn(b, spec.measure.col) : null;
    if (spec.measure && agg !== "count" && (!measureCol || !isNumberCol(measureCol))) {
      skipped.push(b.name);
      continue;
    }
    usable.push({ board: b, items: applyFilters(b, b.items, spec.filters), colCol, measureCol });
  }

  if (!usable.length) return null;

  // Pool the cross-axis values across boards so the columns mean one thing.
  const refCol = usable.find((u) => u.colCol)?.colCol ?? null;
  const pooled: string[] = refCol
    ? usable.flatMap((u) => (u.colCol ? u.items.map((it) => valueOf(it, u.colCol!)) : []))
    : [];
  const colB = refCol ? bucketizeValues(refCol, pooled) : null;

  const rowKeys: BucketKey[] = usable.map((u) => ({ key: u.board.name, tone: "neutral" }));

  const colWeight = new Map<string, number>();
  if (colB) for (const u of usable) for (const it of u.items) {
    if (!u.colCol) continue;
    for (const k of colB.keyOf(valueOf(it, u.colCol))) colWeight.set(k, (colWeight.get(k) ?? 0) + 1);
  }
  const colNatural = !!colB && (colB.mode === "number" || colB.mode === "date");
  const colCap = colB ? capAxis(colB.keys, MAX_COLS, colNatural, (k) => colWeight.get(k.key) ?? 0) : { keys: [], remap: new Map<string, string>() };

  const contributions: Contribution[] = [];
  let ofTotal = 0;
  for (const u of usable) {
    ofTotal += u.board.items.length;
    for (const it of u.items) {
      contributions.push({
        rowKeys: [u.board.name],
        colKeys: colB && u.colCol ? remapKeys(colB.keyOf(valueOf(it, u.colCol)), colCap.remap) : [],
        value: u.measureCol ? numOf(valueOf(it, u.measureCol)) : null,
      });
    }
  }

  const grid = buildGrid(contributions, rowKeys, colCap.keys, agg);

  return {
    rowKeys,
    colKeys: colCap.keys,
    ...grid,
    measureLabel: measureLabelOf(spec.measure),
    matched: usable.reduce((s, u) => s + u.items.length, 0),
    ofTotal,
    skipped,
  };
}

/* --------------------------------------------------------------- widget */

const q = (s: string) => `"${s}"`;

function sliceTitle(spec: SliceSpec): string {
  const rowName = spec.rowCol === BOARD_AXIS ? "לוח" : spec.rowCol;
  const head = spec.measure && spec.measure.agg !== "count"
    ? `${AGG_WORD[spec.measure.agg]} ${q(spec.measure.col)} לפי ${q(rowName)}`
    : spec.colCol ? `${q(rowName)} לפי ${q(spec.colCol)}` : `פילוח לפי ${q(rowName)}`;
  return spec.measure && spec.measure.agg !== "count" && spec.colCol
    ? `${head} × ${q(spec.colCol)}`
    : head;
}

/**
 * The saved, renderable form. One widget kind covers every slice, so a saved
 * dashboard never needs to know which of the old special cases it was.
 */
export function sliceWidget(boards: Board[], spec: SliceSpec): Widget | null {
  const result = spec.rowCol === BOARD_AXIS
    ? sliceBoards(boards, spec)
    : boards[0] ? sliceBoard(boards[0], spec) : null;
  if (!result) return null;

  const source = spec.rowCol === BOARD_AXIS
    ? `${result.rowKeys.length} לוחות${result.skipped.length ? ` · ${result.skipped.length} בלי העמודה` : ""}`
    : `בורד ${q(boards[0].name)}`;

  return { kind: "slice", title: sliceTitle(spec), source, data: { ...result, spec } };
}

/* ------------------------------------------------- an opening suggestion */

/** Past this, a cross-tab has more columns than a person reads at a glance. */
const SUGGEST_MAX_DISTINCT = 8;

/**
 * The one slice worth showing before anybody asks for one.
 *
 * A dashboard that opens on six one-dimensional breakdowns reads as a picture
 * rather than as a tool: nothing on it says the cuts are the reader's to make.
 * So the screen opens on a real two-dimensional cut taken from this board's own
 * columns — the two best-ranked category columns that carry a signal and stay
 * narrow enough to read. Structure only, no words and no AI: the same ranking
 * the dashboard already trusts to order its widgets.
 *
 * Returns null when the board has no two such columns; the screen then simply
 * offers the builder, as before.
 */
export function suggestSlice(board: Board): SliceSpec | null {
  const axes = profileBoard(board).columns.filter(
    (c) =>
      (c.bucket === "status" || c.bucket === "people") &&
      hasSignal(c) &&
      c.distinct <= SUGGEST_MAX_DISTINCT
  );
  if (axes.length < 2) return null;
  return { rowCol: axes[0].title, colCol: axes[1].title };
}

export { EMPTY_KEY, OTHER_KEY };
