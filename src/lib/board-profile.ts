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

/* -------------------------------------------------------------- preferences */

/**
 * What the user told us matters (board_preferences.prefs). Everything optional:
 * an org that never opened the "מה חשוב לך" panel gets pure statistics.
 */
export interface BoardPrefs {
  /** Column IDs the user marked as important. */
  importantColumns?: string[];
  /** Widget keys (`kind|colTitle`) the user pinned (⭐) on the live board. */
  pinnedWidgets?: string[];
  /** Widget keys the user hid (✕) on the live board. */
  hiddenWidgets?: string[];
  /** Free text: what this board is for, in the user's own words. */
  goalsText?: string;
  /** "אצלנו אדום לא אומר סיכון" — label -> tone override (calibration). */
  toneOverrides?: Record<string, string>;
  /** Insight titles the user marked "לא רלוונטי אצלנו". */
  mutedInsights?: string[];
}

/** The one spelling of a widget's identity, shared by server and screen. */
export const widgetKey = (w: { kind: string; col?: string }) => `${w.kind}|${w.col ?? ""}`;

/** Column titles the user's pins point at (the part after the `|`). */
function pinnedTitles(prefs: BoardPrefs): Set<string> {
  return new Set(
    (prefs.pinnedWidgets ?? [])
      .map((k) => k.split("|")[1] ?? "")
      .filter(Boolean)
  );
}

/**
 * Merge the user's preferences into a profile (W2-3). The rule is simple and
 * absolute: a column the user MARKED outranks every column they did not,
 * whatever the statistics say — "מה שחשוב למשתמש גובר על מה שמעניין
 * סטטיסטית". Marks on unknown columns are ignored (nothing is invented), and
 * meta columns stay dead even when marked: Monday's bookkeeping is not a
 * dashboard axis. Pure — the input profile is not mutated.
 */
export function applyPreferences(profile: BoardProfile, prefs: BoardPrefs): BoardProfile {
  // A mark arrives three ways: the explicit importantColumns list (by id), a
  // ⭐-pinned widget on the live board (by the column title inside its key),
  // or a column NAMED inside the free-text purpose — the user who writes
  // "לעקוב אחרי סטטוס טיפול" just said what matters, and the board must react
  // (משוב מיטל 1.9). Matching is against THIS board's own column titles, never
  // a word list of ours, so the golden rule holds; titles shorter than 3
  // characters are skipped ("שם" would match almost any sentence).
  const titles = pinnedTitles(prefs);
  const goals = prefs.goalsText ?? "";
  const markedIds = new Set(
    profile.columns
      .filter(
        (c) =>
          (prefs.importantColumns ?? []).includes(c.id) ||
          titles.has(c.title) ||
          (c.title.length >= 3 && goals.includes(c.title))
      )
      .map((c) => c.id)
  );
  if (!markedIds.size) return profile;

  const isMarked = (c: ColumnProfile) => markedIds.has(c.id) && c.bucket !== "meta";
  const marked = profile.columns.filter(isMarked);
  const rest = profile.columns.filter((c) => !isMarked(c));
  const columns = [...marked, ...rest];

  const important = [
    ...marked,
    ...profile.important.filter((c) => !markedIds.has(c.id)),
  ];

  return { ...profile, columns, important, widgets: suggestWidgets(columns) };
}

/* --------------------------------------------------------- relevance layer */

/**
 * Does this column TELL A STORY, or only occupy space? (משוב מיטל 1.9: לוח
 * עמוס בפרטים לא רלוונטיים.) A breakdown that is 92% one value is a checkbox
 * wearing a chart's clothes; an owner distribution with one name distributes
 * nothing; a number column nobody fills sums nothing. Pure structure — no
 * words, no AI — and the user's ⭐ overrides it (see selectLiveWidgets).
 */
export function hasSignal(c: ColumnProfile): boolean {
  if (c.bucket === "meta" || c.bucket === "text") return false;
  if (c.fillPct < 20) return false;
  if (c.bucket === "status") return c.distinct >= 2 && c.dominantPct <= 90;
  if (c.bucket === "people") return c.distinct >= 2;
  return true; // number / date: filled enough is signal enough
}

export interface LiveWidget {
  kind: Widget["kind"];
  col?: string;
  label: string;
  pinned: boolean;
}

/** A calm dashboard shows at most this many widgets. */
export const LIVE_WIDGET_CAP = 6;

/**
 * Which widgets earn a place on the LIVE dashboard, in what order:
 *   1. whatever the user pinned (⭐) — first, whatever the statistics say;
 *   2. then widgets whose column carries a real signal, by profile rank;
 *   3. capped at LIVE_WIDGET_CAP.
 * Widgets the user hid (✕), widgets with no signal, and cap overflow all land
 * in `more` — droppable from the screen, never from existence, so one click
 * brings any of them back. Per-record `timeline` is skipped: it tells one
 * row's story, not a board's.
 */
export function selectLiveWidgets(
  profile: BoardProfile,
  prefs: BoardPrefs,
  cap = LIVE_WIDGET_CAP
): { show: LiveWidget[]; more: LiveWidget[] } {
  const pinned = new Set(prefs.pinnedWidgets ?? []);
  const hidden = new Set(prefs.hiddenWidgets ?? []);
  const colOf = (title?: string) => profile.columns.find((c) => c.title === title);

  const candidates: LiveWidget[] = profile.widgets
    .filter((w) => w.kind !== "timeline")
    .map((w) => ({ kind: w.kind, col: w.col, label: w.label, pinned: pinned.has(widgetKey(w)) }));

  const signalOf = (w: LiveWidget): boolean => {
    if (w.col) return hasSignal(colOf(w.col)!);
    if (w.kind === "attention") return profile.columns.some((c) => c.bucket === "status" && hasSignal(c));
    return true; // list
  };

  const show: LiveWidget[] = [];
  const more: LiveWidget[] = [];
  // Pinned first, in menu order; then the rest, still in menu order.
  const ordered = [...candidates.filter((w) => w.pinned), ...candidates.filter((w) => !w.pinned)];
  for (const w of ordered) {
    if (hidden.has(widgetKey(w))) { more.push(w); continue; }
    if (!w.pinned && !signalOf(w)) { more.push(w); continue; }
    if (show.length >= cap) { more.push(w); continue; }
    show.push(w);
  }
  return { show, more };
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
