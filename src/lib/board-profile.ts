// Board profile engine — "what matters on THIS board", decided by structure.
//
// This is the deterministic half of the BI wizard (W2-2): it ranks a board's
// columns by TYPE, FILL and BALANCE — a generalisation of the balance metric
// /api/constellation already uses to pick a cluster column — and derives the
// menu of dashboard widgets the board can honestly support. No AI, no words,
// no per-customer code: the same rules profile a donors board and a
// construction site. The AI layer (W2-3) receives this profile as DATA and may
// only reorder within it, never invent columns that are not here.

import type { Board, Col, Widget } from "./board-intelligence";

export type ColumnBucket = "status" | "date" | "people" | "number" | "text" | "meta";

export interface ColumnProfile {
  id: string;
  title: string;
  type: string;
  bucket: ColumnBucket;
  /** % of the board's rows that carry a value in this column. */
  fillPct: number;
  /** Distinct non-empty values. */
  distinct: number;
  /** Share of the biggest bucket among FILLED rows (category columns). */
  dominantPct: number;
  /** 0-100. Derived only from the three numbers above + the type weight. */
  score: number;
}

export interface SuggestedWidget {
  kind: Widget["kind"];
  label: string;
  col?: string;
}

export interface BoardProfile {
  boardId: string;
  boardName: string;
  items: number;
  /** Every column, highest score first. */
  columns: ColumnProfile[];
  /** The columns worth building a dashboard around (score + fill bar). */
  important: ColumnProfile[];
  /** Widgets the board actually supports, in column-score order. */
  widgets: SuggestedWidget[];
}

/* ----------------------------------------------------------- classification */

// Monday's own bookkeeping / structural columns: they exist on every board and
// say nothing about what THIS organisation tracks, so they never rank.
const META_TYPES = ["creation_log", "last_updated", "subtasks", "button", "name"];

function bucketOf(type: string): ColumnBucket {
  if (META_TYPES.includes(type)) return "meta";
  if (["status", "color", "dropdown"].includes(type)) return "status";
  if (["date", "timeline"].includes(type)) return "date";
  if (["people", "person"].includes(type)) return "people";
  if (["numbers", "rating"].includes(type)) return "number";
  return "text";
}

// A category column that splits rows is the heart of a dashboard; a number is
// a KPI; a date is a timeline; free text can at best be listed.
const TYPE_WEIGHT: Record<ColumnBucket, number> = {
  status: 30, number: 25, date: 18, people: 18, text: 8, meta: 0,
};

/** Below either bar a column is not dashboard material. */
const IMPORTANT_MIN_SCORE = 45;
const IMPORTANT_MIN_FILL = 25;

/* ------------------------------------------------------------------ engine */

export function profileBoard(board: Board): BoardProfile {
  const total = board.items.length;

  const profiles = board.columns.map((c, idx) => ({ idx, p: profileColumn(board, c, total) }));

  // Highest score first; ties keep the board's own column order.
  profiles.sort((a, b) => b.p.score - a.p.score || a.idx - b.idx);
  const columns = profiles.map((x) => x.p);

  const important = columns.filter(
    (c) => c.bucket !== "meta" && c.score >= IMPORTANT_MIN_SCORE && c.fillPct >= IMPORTANT_MIN_FILL
  );

  return {
    boardId: board.id,
    boardName: board.name,
    items: total,
    columns,
    important,
    widgets: suggestWidgets(columns),
  };
}

function profileColumn(board: Board, col: Col, total: number): ColumnProfile {
  const bucket = bucketOf(col.type);

  const values = board.items
    .map((it) => (it.values.find((v) => v.colId === col.id || v.title === col.title)?.text || "").trim())
    .filter(Boolean);

  const fillPct = total ? Math.round((values.length / total) * 100) : 0;

  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  const distinct = Object.keys(counts).length;
  const dominantPct = values.length
    ? Math.round((Math.max(...Object.values(counts)) / values.length) * 100)
    : 0;

  let score = 0;
  if (bucket !== "meta") {
    score = TYPE_WEIGHT[bucket] + fillPct * 0.4;
    if (bucket === "status") {
      // The constellation balance metric, generalised: several real buckets are
      // a story; one giant bucket is a checkbox pretending to be a category.
      if (distinct >= 2 && distinct <= 8) score += 15;
      if (dominantPct > 70) score -= 20;
    }
    score = Math.round(Math.min(100, Math.max(0, score)));
  }

  return { id: col.id, title: col.title, type: col.type, bucket, fillPct, distinct, dominantPct, score };
}

/**
 * The widget menu, in the order the profile ranks the columns that feed it.
 * Every entry names its column — the wizard's rule "a widget with no matching
 * column does not exist" is enforced here, not in the prompt.
 */
function suggestWidgets(columns: ColumnProfile[]): SuggestedWidget[] {
  const out: SuggestedWidget[] = [];
  for (const c of columns) {
    if (c.bucket === "meta" || c.score === 0) continue;
    if (c.bucket === "status") out.push({ kind: "breakdown", label: `פילוח לפי "${c.title}"`, col: c.title });
    else if (c.bucket === "people") out.push({ kind: "byOwner", label: `חלוקה לפי "${c.title}"`, col: c.title });
    else if (c.bucket === "date") out.push({ kind: "timeline", label: `ציר זמן לפי "${c.title}"`, col: c.title });
    else if (c.bucket === "number") out.push({ kind: "numberSummary", label: `סיכום "${c.title}"`, col: c.title });
  }
  if (columns.some((c) => c.bucket === "status" && c.score > 0)) {
    out.push({ kind: "attention", label: "מי דורש תשומת לב" });
  }
  out.push({ kind: "list", label: "רשימת הפריטים" });
  return out;
}
