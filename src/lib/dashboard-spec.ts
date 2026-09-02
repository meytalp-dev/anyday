// The contract of a SAVED dashboard (wave 3).
//
// A dashboard row's `spec` is the wizard's output after the user approved it:
// { title, widgets: [{ kind, col? }] }. The AI only ever PROPOSES a spec; this
// module is the wall between that proposal and the database — every widget is
// checked against the board's real profile, so a hallucinated column or an
// unknown kind can never become a saved dashboard. The same rules also produce
// the deterministic fallback used when the AI is unavailable, which keeps the
// wizard working (and testable) offline.

import { selectLiveWidgets, columnMentioned, type BoardProfile, type ColumnBucket } from "./board-profile";
import { BOARD_AXIS, type Agg, type FilterOp, type SliceSpec } from "./slice";

/** The kinds a saved dashboard can render. Per-record `timeline` is deliberately
 *  absent: it tells one row's story, not a board's, so it lives on the profile
 *  card — not on a dashboard. */
export type SpecWidgetKind = "breakdown" | "byOwner" | "numberSummary" | "attention" | "list" | "slice";

export interface SpecWidget {
  kind: SpecWidgetKind;
  /** Column TITLE, for kinds that read one column. Must exist on the board. */
  col?: string;
  /** The slice request, for kind "slice". Validated column-by-column below. */
  slice?: SliceSpec;
}

/** Every aggregation and filter operator the saved contract accepts. Anything
 *  outside these lists is dropped — an unknown verb from an AI is not a verb. */
const AGGS: Agg[] = ["count", "sum", "avg", "min", "max"];
const FILTER_OPS: FilterOp[] = ["is", "isNot", "contains", "gt", "lt", "between", "isEmpty", "notEmpty"];
const MAX_FILTERS = 5;

export interface DashboardSpec {
  title: string;
  widgets: SpecWidget[];
}

export const MAX_SPEC_WIDGETS = 8;
const MAX_TITLE = 80;

/** Which column bucket each col-bound kind may read. */
const KIND_BUCKET: Record<string, ColumnBucket> = {
  breakdown: "status",
  byOwner: "people",
  numberSummary: "number",
};
const COL_FREE_KINDS = new Set(["attention", "list"]);

/**
 * Validate a slice request against the board's real profile.
 *
 * A slice is the only widget carrying nested structure — a row column, a cross
 * column, a measure and filters — so it is also the only place where an AI has
 * four chances to invent a column instead of one. Each is checked separately,
 * and the failures are deliberately NOT symmetric: an invented row column kills
 * the widget (there is nothing left to group by), while an invented cross
 * column, measure or filter is merely dropped, leaving a narrower slice that is
 * still true. Degrading to a smaller honest answer beats showing nothing.
 *
 * BOARD_AXIS passes through: a cross-board slice is validated against the real
 * boards in the save route, which is the only place that knows them.
 */
export function sanitizeSliceSpec(raw: unknown, profile: BoardProfile): SliceSpec | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const titleOf = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const has = (t: string) => profile.columns.some((c) => c.title === t && c.bucket !== "meta");
  const isNumberCol = (t: string) => profile.columns.some((c) => c.title === t && c.bucket === "number");

  const rowCol = titleOf(r.rowCol);
  if (!rowCol) return null;
  if (rowCol !== BOARD_AXIS && !has(rowCol)) return null;

  const out: SliceSpec = { rowCol };

  const colCol = titleOf(r.colCol);
  // A column crossed with itself is a diagonal, not a finding.
  if (colCol && colCol !== rowCol && has(colCol)) out.colCol = colCol;

  const m = (r.measure ?? {}) as Record<string, unknown>;
  const mCol = titleOf(m.col);
  const mAgg = titleOf(m.agg) as Agg;
  if (mCol && AGGS.includes(mAgg) && (mAgg === "count" || isNumberCol(mCol))) {
    out.measure = { col: mCol, agg: mAgg };
  }

  const rawFilters = Array.isArray(r.filters) ? r.filters : [];
  const filters: NonNullable<SliceSpec["filters"]> = [];
  for (const f of rawFilters.slice(0, MAX_FILTERS)) {
    const fo = (f ?? {}) as Record<string, unknown>;
    const col = titleOf(fo.col);
    const op = titleOf(fo.op) as FilterOp;
    if (!col || !has(col) || !FILTER_OPS.includes(op)) continue;
    const value = typeof fo.value === "string" ? fo.value.slice(0, 200) : undefined;
    const value2 = typeof fo.value2 === "string" ? fo.value2.slice(0, 200) : undefined;
    filters.push({ col, op, ...(value !== undefined ? { value } : {}), ...(value2 !== undefined ? { value2 } : {}) });
  }
  if (filters.length) out.filters = filters;

  return out;
}

/**
 * Validate a proposed spec against the board's real profile. Widgets that
 * point at a column the board does not have, at a column of the wrong type, or
 * at an unknown kind are dropped — never "fixed", because a guessed repair is
 * still an invention. Duplicates collapse, and at most MAX_SPEC_WIDGETS survive.
 */
export function sanitizeSpec(raw: unknown, profile: BoardProfile): DashboardSpec {
  const r = (raw ?? {}) as Record<string, unknown>;
  const title = (typeof r.title === "string" ? r.title : "").trim().slice(0, MAX_TITLE) || defaultTitle(profile);

  const widgets: SpecWidget[] = [];
  const seen = new Set<string>();
  const rawWidgets = Array.isArray(r.widgets) ? r.widgets : [];

  for (const w of rawWidgets) {
    if (widgets.length >= MAX_SPEC_WIDGETS) break;
    const kind = String((w as Record<string, unknown>)?.kind ?? "");
    const col = (w as Record<string, unknown>)?.col;

    let clean: SpecWidget | null = null;
    if (kind === "slice") {
      const sl = sanitizeSliceSpec((w as Record<string, unknown>)?.slice, profile);
      if (sl) clean = { kind: "slice", slice: sl };
    } else if (COL_FREE_KINDS.has(kind)) {
      clean = { kind: kind as SpecWidgetKind };
    } else if (kind in KIND_BUCKET && typeof col === "string") {
      const match = profile.columns.find((c) => c.title === col && c.bucket === KIND_BUCKET[kind]);
      if (match) clean = { kind: kind as SpecWidgetKind, col: match.title };
    }
    if (!clean) continue;

    const key = `${clean.kind}|${clean.col ?? ""}|${clean.slice ? JSON.stringify(clean.slice) : ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    widgets.push(clean);
  }

  return { title, widgets };
}

function defaultTitle(profile: BoardProfile): string {
  return `דשבורד ${profile.boardName}`.slice(0, MAX_TITLE);
}

/** bucket -> the widget kind that shows one column of that bucket. */
const BUCKET_KIND: Partial<Record<ColumnBucket, SpecWidgetKind>> = {
  status: "breakdown",
  people: "byOwner",
  number: "numberSummary",
};

/**
 * The explicit-ask guarantee (משוב מיטל: "ביקשתי סטטוס טיפול — הוא נתן רק את
 * הפילוח"): a column the user NAMED in the purpose sentence must appear in the
 * dashboard, whatever the AI proposed and whatever the relevance layer thinks.
 * Matching is against this board's own column titles (short titles skipped);
 * missing widgets are pushed to the FRONT — what was asked for leads.
 */
export function ensureMentionedColumns(
  spec: DashboardSpec,
  purpose: string,
  profile: BoardProfile
): DashboardSpec {
  const additions: SpecWidget[] = [];
  for (const c of profile.columns) {
    if (!columnMentioned(c.title, purpose)) continue;
    const kind = BUCKET_KIND[c.bucket];
    if (!kind) continue;
    if (spec.widgets.some((w) => w.col === c.title)) continue;
    additions.push({ kind, col: c.title });
  }
  if (!additions.length) return spec;
  return { ...spec, widgets: [...additions, ...spec.widgets].slice(0, MAX_SPEC_WIDGETS) };
}

/**
 * The deterministic proposal: the profile's own widget menu (already in
 * column-score order, already honest about what the board supports), trimmed
 * to a calm dashboard. Used when the AI fails or is not configured — the
 * wizard degrades to "the engine's best guess", never to an error screen.
 */
export function defaultSpec(profile: BoardProfile): DashboardSpec {
  // Through the relevance layer, not the raw menu: a fallback dashboard must
  // be calm too — no story-less breakdowns, no one-name "distributions".
  const { show } = selectLiveWidgets(profile, {});
  const spec = sanitizeSpec(
    { title: defaultTitle(profile), widgets: show.map((w) => ({ kind: w.kind, col: w.col })) },
    profile
  );
  return { ...spec, widgets: spec.widgets.slice(0, 6) };
}
