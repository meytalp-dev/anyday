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

/** Monday/sheet column type -> semantic bucket. Exported so the slice engine
 *  groups by the SAME type rules the profile ranks by — one source of truth. */
export function bucketOf(type: string): ColumnBucket {
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
 * Does this free text mention this column — flexibly? (בקשת מיטל: התאמה גמישה.)
 * Exact title substring always matches. Beyond that, word-level matching with
 * Hebrew prefix tolerance ("הסטטוס" ↔ "סטטוס", "בטלפון" ↔ "טלפון"): at least
 * half the title's words must appear in the text, and the matched words must
 * total 4+ characters — so "טלפון" finds "מספר טלפון", but "בית שאן" does NOT
 * light up "בית ספר", and a two-letter title like "שם" never matches by parts.
 * Deterministic and per-board — still no word list of ours (the golden rule).
 */
export function columnMentioned(title: string, text: string): boolean {
  const t = title.trim();
  if (!t || !text) return false;
  if (t.length >= 3 && text.includes(t)) return true;

  const words = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
  // Strip one leading Hebrew prefix letter (ה/ו/ב/ל/ש/כ) when 3+ letters remain.
  const strip = (w: string) => (w.length >= 4 && "הובלשכ".includes(w[0]) ? w.slice(1) : w);

  const textSet = new Set(words(text).flatMap((w) => [w, strip(w)]));
  const titleWords = words(t);
  if (!titleWords.length) return false;

  const matched = titleWords.filter((w) => textSet.has(w) || textSet.has(strip(w)));
  const matchedLen = matched.reduce((s, w) => s + w.length, 0);
  return matched.length / titleWords.length >= 0.5 && matchedLen >= 4;
}

/**
 * "You asked for a column that is not on THIS board — but it exists THERE."
 * (המקרה של מיטל: "סטטוס טיפול" התבקש על לוח שאין בו עמודה כזו.) Given the
 * purpose text and the OTHER boards' column titles, returns the first board
 * that carries a mentioned column — so the wizard can say the honest sentence
 * instead of silently building something else. Null when the purpose names
 * nothing anywhere: a generic purpose must not produce noise.
 */
export function findColumnElsewhere(
  purpose: string,
  boards: { id: string; name: string; titles: string[] }[]
): { boardId: string; boardName: string; column: string } | null {
  if (!purpose.trim()) return null;
  for (const b of boards) {
    const column = b.titles.find((t) => columnMentioned(t, purpose));
    if (column) return { boardId: b.id, boardName: b.name, column };
  }
  return null;
}

/**
 * Every column the prefs say MATTERS, by title — a mark arrives three ways:
 * an explicit importantColumns id, a ⭐-pinned widget, or the column's own
 * name written into the free-text purpose ("לעקוב אחרי סטטוס טיפול" names a
 * column ⇒ it matters). Matching is against THIS board's own titles, never a
 * word list of ours; titles under 3 characters are skipped ("שם" would match
 * almost any sentence). One definition, used by both the ranking
 * (applyPreferences) and the relevance filter (selectLiveWidgets) — a column
 * the user asked for by name must never be statistically filtered away.
 */
export function markedColumnTitles(profile: BoardProfile, prefs: BoardPrefs): Set<string> {
  const titles = pinnedTitles(prefs);
  const goals = prefs.goalsText ?? "";
  for (const c of profile.columns) {
    if ((prefs.importantColumns ?? []).includes(c.id)) titles.add(c.title);
    else if (columnMentioned(c.title, goals)) titles.add(c.title);
  }
  return titles;
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
  // See markedColumnTitles for what counts as a mark (ids, pins, and columns
  // named inside the purpose text — משוב מיטל 1.9).
  const titles = markedColumnTitles(profile, prefs);
  const markedIds = new Set(
    profile.columns.filter((c) => titles.has(c.title)).map((c) => c.id)
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
  // A column the user marked — by pin, by id, or BY NAME in the purpose text —
  // bypasses the signal filter: what was asked for in words is never
  // statistically filtered away (משוב מיטל: "ביקשתי סטטוס טיפול").
  const marked = markedColumnTitles(profile, prefs);
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
    if (!w.pinned && !(w.col && marked.has(w.col)) && !signalOf(w)) { more.push(w); continue; }
    if (show.length >= cap) { more.push(w); continue; }
    show.push(w);
  }
  return { show, more };
}

/**
 * Clickable example purposes for the wizard (משוב מיטל: "צריך לתת דוגמאות
 * לדברים שאפשר לבנות"). Built from THIS board's own signal-bearing columns —
 * an example that names the user's real column teaches what a purpose looks
 * like far better than generic text, and never promises a widget the board
 * cannot deliver. Always ends with one generic example so even a bare board
 * offers something to click.
 */
export function examplePurposes(profile: BoardProfile): string[] {
  const first = (b: ColumnBucket) => profile.columns.find((c) => c.bucket === b && hasSignal(c));
  const out: string[] = [];
  const st = first("status");
  if (st) out.push(`לראות במבט אחד את הפילוח לפי ${st.title}, ומי דורש טיפול`);
  const num = first("number");
  if (num) out.push(`לעקוב אחרי ${num.title} — הסכום, הממוצע, ומי בולט`);
  const ppl = first("people");
  if (ppl) out.push(`חלוקת עומס: מי מטפל בכמה, לפי ${ppl.title}`);
  out.push("תמונת מצב שבועית להנהלה — רק המספרים החשובים");
  return out.slice(0, 4);
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
