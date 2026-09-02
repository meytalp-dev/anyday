// The generic "board intelligence" engine.
// It works by Monday COLUMN TYPES, never by column NAMES — so it adapts to any
// nonprofit's structure, in any language. Given a board's columns + items, it
// figures out which analyses/visualizations are meaningful and computes them.

export interface Col { id: string; title: string; type: string; settings_str?: string; }
export interface ItemVal { colId: string; title: string; type: string; text: string; }
export interface Item { id: string; name: string; values: ItemVal[]; }
export interface Board { id: string; name: string; columns: Col[]; items: Item[]; }

export interface Widget {
  kind: "breakdown" | "byOwner" | "timeline" | "numberSummary" | "list" | "attention" | "crossBreakdown" | "slice";
  title: string;
  source: string;
  data: unknown;
}

// Map raw Monday types to our semantic buckets.
const isStatus = (t: string) => t === "status" || t === "color" || t === "dropdown";
const isDate = (t: string) => t === "date" || t === "timeline" || t === "creation_log" || t === "last_updated";
const isPeople = (t: string) => t === "people" || t === "person";
const isNumber = (t: string) => t === "numbers" || t === "rating";

/* ---------------------------------------------------------------------------
 * MEANING FROM COLOUR, NOT FROM WORDS
 *
 * Every label in a Monday status column carries its own colour, and that colour
 * means the same thing in Hebrew, Arabic and English: red = a problem,
 * orange = in flight, green = finished. So the engine reads the board's own
 * column settings (`settings_str`) and decides by the colour's HUE - a number -
 * never by the text of the label, and never by a fixed list of hex codes. Any
 * organisation, any language, any palette lands in the right bucket with zero
 * per-customer code.
 * ------------------------------------------------------------------------- */

export type Tone = "risk" | "progress" | "done" | "neutral";
export type ToneMap = Record<string, Tone>;

/** "#rgb" / "#rrggbb" -> hue (0-360) + saturation + lightness (0-1). */
function hsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let x = m[1];
  if (x.length === 3) x = x.split("").map((c) => c + c).join("");
  const r = parseInt(x.slice(0, 2), 16) / 255;
  const g = parseInt(x.slice(2, 4), 16) / 255;
  const b = parseInt(x.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

/**
 * Hue -> semantic tone. The cut points are colour-wheel sectors, not a palette:
 *   red / pink    -> risk        orange / yellow -> progress
 *   green / teal  -> done        blue / purple   -> neutral (informational)
 * Greys and near-black/near-white carry no signal, so they stay neutral.
 */
export function toneFromColor(hex: string): Tone {
  const c = hsl(hex);
  if (!c) return "neutral";
  if (c.s < 0.15 || c.l < 0.12 || c.l > 0.93) return "neutral";
  if (c.h >= 330 || c.h < 25) return "risk";
  if (c.h < 70) return "progress";
  if (c.h < 180) return "done";
  return "neutral";
}

interface RawLabel { id?: string | number; name?: string; color?: unknown }
interface RawSettings {
  labels?: Record<string, string> | RawLabel[];
  labels_colors?: Record<string, { color?: string }>;
}

const toneCache = new Map<string, ToneMap | null>();

/**
 * The column's own label -> tone table, read from `settings_str`.
 * Returns null when the column carries no colour at all (a plain `dropdown`,
 * or a board Monday returned without settings) - that is the ONLY case in
 * which the word fallback below is allowed to speak.
 */
export function labelTones(col: Col): ToneMap | null {
  const raw = col.settings_str;
  if (!raw) return null;
  const cached = toneCache.get(raw);
  if (cached !== undefined) return cached;
  const parsed = parseLabelTones(raw);
  if (toneCache.size > 300) toneCache.clear();
  toneCache.set(raw, parsed);
  return parsed;
}

function parseLabelTones(raw: string): ToneMap | null {
  let s: RawSettings;
  try { s = JSON.parse(raw) as RawSettings; } catch { return null; }
  const hexOf = (v: unknown): string | null => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const c = (v as { color?: unknown }).color;
      if (typeof c === "string") return c;
    }
    return null;
  };
  const out: ToneMap = {};
  if (Array.isArray(s.labels)) {
    // newer shape: [{ id, name, color }] - `dropdown` uses this WITHOUT colour
    for (const l of s.labels) {
      const hex = hexOf(l?.color);
      if (typeof l?.name === "string" && hex) out[l.name] = toneFromColor(hex);
    }
  } else if (s.labels && typeof s.labels === "object") {
    // classic shape: labels {"0":"Done"} + labels_colors {"0":{color:"#00c875"}}
    for (const [id, name] of Object.entries(s.labels)) {
      if (typeof name !== "string") continue;
      const hex = hexOf(s.labels_colors?.[id]);
      if (hex) out[name] = toneFromColor(hex);
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * FALLBACK ONLY - not "the list of risky words", and not to be extended.
 * It runs in exactly one case: the column handed us no colour for this value
 * (a `dropdown` column, or free text typed outside the column's own labels),
 * so there is nothing to derive a tone from. Every column Monday colours -
 * i.e. every `status`/`color` column - never reaches this line.
 * The fix for a board that lands here is colour in Monday, not more words.
 */
const RISK_WORDS_FALLBACK = ["סיכון", "תקוע", "עצר", "נשיר", "דחוף", "בעיה", "ממתין", "חריג", "risk", "stuck", "blocked", "urgent", "overdue"];

/** Tone of one value in one column: colour first; words only when there is none. */
export function toneOf(col: Col, value: string): Tone {
  if (!value) return "neutral";
  const fromColor = labelTones(col)?.[value];
  if (fromColor) return fromColor;
  return RISK_WORDS_FALLBACK.some((w) => value.includes(w)) ? "risk" : "neutral";
}

/**
 * Every status value on this board -> its tone. This is what the browser gets,
 * so the UI can paint a chip without knowing a single word in any language.
 */
export function statusTones(board: Board): ToneMap {
  const out: ToneMap = {};
  for (const col of board.columns.filter((c) => isStatus(c.type))) {
    const declared = labelTones(col);
    if (declared) for (const [label, t] of Object.entries(declared)) if (!out[label]) out[label] = t;
    for (const it of board.items) {
      const v = valueOf(it, col);
      if (v && !out[v]) out[v] = toneOf(col, v);
    }
  }
  return out;
}

/** One item's text for one column. Exported for the slice engine. */
export function valueOf(item: Item, col: Col): string {
  return item.values.find((v) => v.colId === col.id || v.title === col.title)?.text || "";
}

/** What CAN this board show? Returns the menu of possible widgets (for the chat/canvas). */
export function capabilities(board: Board): { kind: Widget["kind"]; label: string; col?: string }[] {
  const caps: { kind: Widget["kind"]; label: string; col?: string }[] = [];
  const statusCols = board.columns.filter((c) => isStatus(c.type));
  const dateCols = board.columns.filter((c) => isDate(c.type));
  const peopleCols = board.columns.filter((c) => isPeople(c.type));
  const numCols = board.columns.filter((c) => isNumber(c.type));

  statusCols.forEach((c) => caps.push({ kind: "breakdown", label: `פילוח לפי "${c.title}"`, col: c.title }));
  peopleCols.forEach((c) => caps.push({ kind: "byOwner", label: `חלוקה לפי "${c.title}"`, col: c.title }));
  dateCols.forEach((c) => caps.push({ kind: "timeline", label: `ציר זמן לפי "${c.title}"`, col: c.title }));
  numCols.forEach((c) => caps.push({ kind: "numberSummary", label: `סיכום "${c.title}"`, col: c.title }));
  if (statusCols.length) caps.push({ kind: "attention", label: "מי דורש תשומת לב" });
  caps.push({ kind: "list", label: "רשימת הפריטים" });
  return caps;
}

/** Compute a breakdown of items by a status-type column. */
export function breakdown(board: Board, colTitle?: string): Widget | null {
  const col = colTitle ? board.columns.find((c) => c.title === colTitle && isStatus(c.type))
    : board.columns.find((c) => isStatus(c.type));
  if (!col) return null;
  const counts: Record<string, number> = {};
  for (const it of board.items) {
    const v = valueOf(it, col) || "— ריק —";
    counts[v] = (counts[v] || 0) + 1;
  }
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n, tone: toneOf(col, label) }));
  return { kind: "breakdown", title: `פילוח לפי "${col.title}"`, source: `בורד "${board.name}" · עמודת "${col.title}"`, data: { rows, total: board.items.length } };
}

/** Distribution by a people-type column (workload by owner). */
export function byOwner(board: Board, colTitle?: string): Widget | null {
  const col = colTitle ? board.columns.find((c) => c.title === colTitle && isPeople(c.type))
    : board.columns.find((c) => isPeople(c.type));
  if (!col) return null;
  const counts: Record<string, number> = {};
  for (const it of board.items) {
    const v = valueOf(it, col) || "— ללא —";
    v.split(",").map((s) => s.trim()).filter(Boolean).forEach((name) => { counts[name] = (counts[name] || 0) + 1; });
  }
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n }));
  return { kind: "byOwner", title: `חלוקה לפי "${col.title}"`, source: `בורד "${board.name}" · עמודת "${col.title}"`, data: { rows } };
}

/**
 * Items that need attention - chosen by the TONE of their status value, which
 * comes from the colour the board itself gave that label. No word matching.
 */
export function attention(board: Board): Widget {
  const hits: { name: string; why: string }[] = [];
  const statusCols = board.columns.filter((c) => isStatus(c.type));
  for (const it of board.items) {
    for (const c of statusCols) {
      const v = valueOf(it, c);
      if (v && toneOf(c, v) === "risk") { hits.push({ name: it.name, why: `${c.title}: ${v}` }); break; }
    }
  }
  return { kind: "attention", title: "דורשים תשומת לב", source: `בורד "${board.name}"`, data: { items: hits, count: hits.length } };
}

/** Summary of a number column (sum / avg / max). */
export function numberSummary(board: Board, colTitle?: string): Widget | null {
  const col = colTitle ? board.columns.find((c) => c.title === colTitle && isNumber(c.type))
    : board.columns.find((c) => isNumber(c.type));
  if (!col) return null;
  const nums = board.items.map((it) => parseFloat(valueOf(it, col))).filter((n) => !isNaN(n));
  if (!nums.length) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return { kind: "numberSummary", title: `סיכום "${col.title}"`, source: `בורד "${board.name}" · עמודת "${col.title}"`,
    data: { sum, avg: Math.round((sum / nums.length) * 10) / 10, max: Math.max(...nums), count: nums.length } };
}

/** A plain list of items. */
export function list(board: Board, limit = 12): Widget {
  return { kind: "list", title: `רשימת "${board.name}"`, source: `בורד "${board.name}"`,
    data: { items: board.items.slice(0, limit).map((it) => it.name), total: board.items.length } };
}

/**
 * Derive the vocabulary for a board WITHOUT hardcoding any nonprofit's terms.
 * "entityWord" = what to call a row (בוגר/מוטב/בעל-חיים/משפחה). We guess from the
 * board name; if unsure we fall back to the neutral "רשומות". Never invents.
 */
export function terminology(board: Board): { entity: string; entityPlural: string } {
  const n = board.name;
  // pull a leading noun-ish token from the board name if it looks like a plural entity
  const known: [RegExp, string, string][] = [
    [/בוגר/, "בוגר", "בוגרים"],
    [/מוטב/, "מוטב", "מוטבים"],
    [/תלמיד/, "תלמיד", "תלמידים"],
    [/משפח/, "משפחה", "משפחות"],
    [/מתנדב/, "מתנדב", "מתנדבים"],
    [/נער|נוער/, "נער", "בני נוער"],
    [/לקוח/, "לקוח", "לקוחות"],
    [/מטופל/, "מטופל", "מטופלים"],
    [/חייל/, "חייל", "חיילים"],
    [/קשיש|זקן/, "קשיש", "קשישים"],
    [/חיה|בעל.?ח/, "בעל חיים", "בעלי חיים"],
    [/איש קשר|אנשי קשר/, "איש קשר", "אנשי קשר"],
  ];
  for (const [re, s, p] of known) if (re.test(n)) return { entity: s, entityPlural: p };
  return { entity: "רשומה", entityPlural: "רשומות" };
}

/**
 * Build headline KPIs that are MEANINGFUL for THIS board, derived from its own
 * columns — never the fixed "active/completed" that only fit graduates.
 * Rule: total (always), + for each status column: the size of its largest
 * bucket labeled with that bucket's real value, + attention count (only if a
 * status column has risky-looking values), + number-column sum (if any).
 */
export function headlineKpis(board: Board): { icon: string; n: number; label: string; tone: string }[] {
  const term = terminology(board);
  const out: { icon: string; n: number; label: string; tone: string }[] = [];
  out.push({ icon: "◆", n: board.items.length, label: `סה"כ ${term.entityPlural}`, tone: "brand" });

  const statusCols = board.columns.filter((c) => isStatus(c.type));
  if (statusCols.length) {
    // biggest bucket of the first status column — label = its real value
    const bd = breakdown(board, statusCols[0].title);
    const rows = (bd?.data as { rows: { label: string; n: number }[] })?.rows || [];
    const top = rows.find((r) => r.label !== "— ריק —") || rows[0];
    if (top) out.push({ icon: "●", n: top.n, label: `${statusCols[0].title}: ${top.label}`, tone: "mint" });

    // attention only if there ARE risky values
    const att = attention(board);
    const c = (att.data as { count: number }).count;
    if (c > 0) out.push({ icon: "▲", n: c, label: "טעונים בדיקה", tone: "rose" });
  }

  const numCol = board.columns.find((c) => isNumber(c.type));
  if (numCol) {
    const ns = numberSummary(board, numCol.title);
    if (ns) out.push({ icon: "∑", n: (ns.data as { sum: number }).sum, label: `סך "${numCol.title}"`, tone: "amber" });
  }
  return out.slice(0, 4);
}

/** Auto-build the most useful default widgets for a board, in priority order. */
export function autoWidgets(board: Board): Widget[] {
  const out: Widget[] = [];
  const b = breakdown(board); if (b) out.push(b);
  const a = attention(board); if ((a.data as { count: number }).count > 0) out.push(a);
  const o = byOwner(board); if (o && (o.data as { rows: unknown[] }).rows.length > 1) out.push(o);
  const n = numberSummary(board); if (n) out.push(n);
  if (out.length < 2) out.push(list(board));
  return out;
}

/* ---------------------------------------------------------------------------
 * ONE RECORD'S TIMELINE — its own story, in the order it actually happened.
 *
 * Every date-type column on the board is a stage. A stage's NAME is that
 * column's own title, exactly as the board spells it — nothing here knows what
 * a stage is called, in any language. The ORDER comes from the dates the
 * record actually carries, never from the column order on the board and never
 * from a list in this file.
 *
 * A date column the record has not filled in is a stage that has not happened
 * yet. That is information, not noise, so it is returned too (`at: null`) and
 * placed after everything that already has a date — the screen shows it faded
 * rather than dropping it silently.
 *
 * A board with no date column at all has no timeline: this returns null, and
 * the screen shows nothing.
 * ------------------------------------------------------------------------- */

export interface Stage {
  colId: string;
  title: string;        // the board's own column title = the stage's name
  text: string;         // the raw value, as Monday rendered it
  at: number | null;    // ms since epoch (local midnight), null = not yet
  iso: string | null;   // YYYY-MM-DD, null = not yet
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/**
 * The first calendar date inside a Monday date-ish value, as local midnight.
 * Handles what Monday's `text` actually returns: ISO ("2026-02-03", with or
 * without a clock), a `timeline` range ("2026-02-03 - 2026-03-01" -> its
 * start), and a day-first written date ("3.2.2026", "3/2/26") — day-first
 * because that is how the date is written where this product is used.
 * Anything that is not a date returns null; it is simply not a stage.
 */
export function parseBoardDate(text: string): { at: number; iso: string } | null {
  if (!text) return null;
  const s = text.trim();
  let y: number, m: number, d: number;
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
  else {
    const dmy = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(s);
    if (!dmy) return null;
    d = +dmy[1]; m = +dmy[2]; y = +dmy[3];
    if (y < 100) y += 2000;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return { at: dt.getTime(), iso: `${y}-${pad2(m)}-${pad2(d)}` };
}

/** The timeline of ONE record. null = this board has no date column. */
export function timeline(board: Board, item: Item): Widget | null {
  // `creation_log` and `last_updated` are Monday's own bookkeeping COLUMN TYPES:
  // they exist on every board and on every record, so they would flood the
  // timeline with noise instead of telling the record's story. Excluded here
  // only — `isDate` itself still recognises them for capabilities(). The filter
  // is by column TYPE, never by column name or by the text inside it.
  const META_DATE_TYPES = ["creation_log", "last_updated"];
  const dateCols = board.columns.filter((c) => isDate(c.type) && !META_DATE_TYPES.includes(c.type));
  // A board whose only date-ish columns are those meta types has no timeline.
  if (!dateCols.length) return null;

  const stages = dateCols
    .map((col, order) => {
      const text = valueOf(item, col);
      const p = parseBoardDate(text);
      return { order, stage: { colId: col.id, title: col.title, text, at: p?.at ?? null, iso: p?.iso ?? null } as Stage };
    })
    // dated first, in date order; undated after them, keeping the board's order
    .sort((a, b) => {
      if (a.stage.at === null || b.stage.at === null) {
        if (a.stage.at === b.stage.at) return a.order - b.order;
        return a.stage.at === null ? 1 : -1;
      }
      return a.stage.at - b.stage.at || a.order - b.order;
    })
    .map((x) => x.stage);

  const passed = stages.filter((s) => s.at !== null).length;
  return {
    kind: "timeline",
    title: `ציר הזמן של "${item.name}"`,
    source: `בורד "${board.name}" · ${dateCols.length} עמודות תאריך`,
    data: { stages, passed, total: stages.length },
  };
}
