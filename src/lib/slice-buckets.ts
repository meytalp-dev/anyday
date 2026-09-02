// Turning ANY column into categories you can slice by.
//
// A status column is easy: it has four labels. A donations column with 900
// distinct amounts is not a slice — it is a list. So every column, of every
// type, goes through one bucketer that decides HOW to categorise it from the
// column's TYPE alone: a label stays a label, a number is cut into ranges, a
// date is grouped by month/quarter/year according to its real span, and free
// text collapses to the common values plus "other".
//
// The golden rule holds throughout: decisions come from the column's type and
// from the colour the board gave each label — never from words in the title.

import { toneOf, parseBoardDate, valueOf, type Col, type Item, type Tone } from "./board-intelligence";
import { bucketOf } from "./board-profile";

export const EMPTY_KEY = "— ריק —";
export const OTHER_KEY = "— אחר —";

export type BucketMode = "label" | "people" | "number" | "date" | "text";
export type DateGrain = "month" | "quarter" | "year";

export interface BucketKey {
  key: string;
  tone: Tone;
  /** Natural order for ranges and dates; absent means "order as given". */
  sort?: number;
}

export interface Buckets {
  mode: BucketMode;
  grain?: DateGrain;
  keys: BucketKey[];
  /** Which bucket(s) a raw cell value belongs to. Several, for people columns. */
  keyOf(raw: string): string[];
}

/** Above this many distinct values, a category column is noise, not a slice. */
const MAX_TEXT_KEYS = 8;
/** A number column with few distinct values is a rating or a year — not ranges. */
const NUMBER_AS_LABEL_MAX = 8;
const TARGET_BINS = 5;

const MONTHS_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

/** The declared label order of a status column, so the slice reads like the board. */
function declaredOrder(col: Col): string[] {
  try {
    const s = JSON.parse(col.settings_str || "{}") as { labels?: unknown };
    const labels = s.labels;
    if (Array.isArray(labels)) return labels.map((l) => String((l as { name?: unknown })?.name ?? "")).filter(Boolean);
    if (labels && typeof labels === "object") return Object.values(labels as Record<string, unknown>).map(String).filter(Boolean);
  } catch { /* a board with no settings is not an error */ }
  return [];
}

function parseNum(text: string): number | null {
  if (!text) return null;
  const n = Number(text.replace(/[,\s₪$€]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** 1 / 2 / 5 x 10^k — the step sizes people actually read on an axis. */
function niceStep(rough: number): number {
  if (rough <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

const fmtNum = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 100) / 100).toLocaleString("he-IL");

function rangeLabel(lo: number, hi: number): string {
  return `${fmtNum(lo)}–${fmtNum(hi)}`;
}

function dateKey(at: number, grain: DateGrain): { key: string; sort: number } {
  const d = new Date(at);
  const y = d.getFullYear();
  if (grain === "year") return { key: String(y), sort: y * 10000 };
  if (grain === "quarter") {
    const q = Math.floor(d.getMonth() / 3) + 1;
    return { key: `רבעון ${q} ${y}`, sort: y * 10000 + q * 100 };
  }
  const m = d.getMonth();
  return { key: `${MONTHS_HE[m]} ${y}`, sort: y * 10000 + (m + 1) };
}

/** Order a bucket list: declared/natural order when there is one, else by frequency. */
function orderKeys(keys: Map<string, BucketKey>, counts: Map<string, number>, natural: boolean): BucketKey[] {
  const arr = [...keys.values()];
  if (natural) arr.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  else arr.sort((a, b) => (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0));
  // The empty and "other" buckets always sit last: they are the residue, not a finding.
  const residue = (k: BucketKey) => (k.key === OTHER_KEY ? 2 : k.key === EMPTY_KEY ? 1 : 0);
  return arr.sort((a, b) => residue(a) - residue(b));
}

/**
 * Categorise one column across the given items.
 *
 * The returned `keyOf` is the contract the slice engine uses: give it a raw
 * cell value, get back the bucket(s) that value belongs to. Everything about
 * ranges, date grain and the "other" cut-off is decided once, here.
 */
export function bucketize(col: Col, items: Item[]): Buckets {
  return bucketizeValues(col, items.map((it) => valueOf(it, col)));
}

/**
 * The same categorisation from raw cell values instead of items.
 *
 * Cross-board slicing needs this: the same column lives under a different id
 * (and a different title) on every board, so the values must be POOLED before
 * the ranges are chosen. Bucketing each board separately would give each one
 * its own ranges and the columns of the table would not mean the same thing —
 * a table whose columns differ per row is a lie.
 */
export function bucketizeValues(col: Col, raws: string[]): Buckets {
  const bucket = bucketOf(col.type);
  if (bucket === "people") return peopleBuckets(col, raws);
  if (bucket === "date") return dateBuckets(col, raws);
  if (bucket === "number") return numberBuckets(col, raws);
  return labelBuckets(col, raws, bucket === "status");
}

/* ---------------------------------------------------------------- labels */

function labelBuckets(col: Col, raws: string[], isStatus: boolean): Buckets {
  const counts = new Map<string, number>();
  for (const r of raws) {
    const k = r.trim() || EMPTY_KEY;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  // Free text with too many distinct values collapses to the common ones + other.
  const overflow = new Set<string>();
  if (!isStatus && counts.size > MAX_TEXT_KEYS + 1) {
    const ranked = [...counts.entries()]
      .filter(([k]) => k !== EMPTY_KEY)
      .sort((a, b) => b[1] - a[1]);
    ranked.slice(MAX_TEXT_KEYS).forEach(([k]) => overflow.add(k));
  }

  const keys = new Map<string, BucketKey>();
  const declared = isStatus ? declaredOrder(col) : [];
  const rank = new Map(declared.map((name, i) => [name, i]));

  for (const [k, n] of counts) {
    void n;
    const key = overflow.has(k) ? OTHER_KEY : k;
    if (!keys.has(key)) {
      keys.set(key, {
        key,
        tone: key === EMPTY_KEY || key === OTHER_KEY ? "neutral" : toneOf(col, key),
        sort: rank.has(key) ? rank.get(key)! : undefined,
      });
    }
  }

  const effective = new Map<string, number>();
  for (const [k, n] of counts) {
    const key = overflow.has(k) ? OTHER_KEY : k;
    effective.set(key, (effective.get(key) ?? 0) + n);
  }

  // A status column with a declared order shows THAT order; anything else, by size.
  const useDeclared = isStatus && declared.length > 0 && [...keys.values()].every((k) => k.sort !== undefined || k.key === EMPTY_KEY || k.key === OTHER_KEY);

  return {
    mode: isStatus ? "label" : "text",
    keys: orderKeys(keys, effective, useDeclared),
    keyOf: (raw: string) => {
      const k = raw.trim() || EMPTY_KEY;
      return [overflow.has(k) ? OTHER_KEY : k];
    },
  };
}

/* ---------------------------------------------------------------- people */

const splitPeople = (raw: string) => raw.split(",").map((s) => s.trim()).filter(Boolean);

function peopleBuckets(col: Col, raws: string[]): Buckets {
  void col;
  const counts = new Map<string, number>();
  for (const r of raws) {
    const names = splitPeople(r);
    if (!names.length) counts.set(EMPTY_KEY, (counts.get(EMPTY_KEY) ?? 0) + 1);
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const keys = new Map<string, BucketKey>();
  for (const k of counts.keys()) keys.set(k, { key: k, tone: "neutral" });
  return {
    mode: "people",
    keys: orderKeys(keys, counts, false),
    keyOf: (raw: string) => {
      const names = splitPeople(raw);
      return names.length ? names : [EMPTY_KEY];
    },
  };
}

/* ---------------------------------------------------------------- number */

function numberBuckets(col: Col, raws: string[]): Buckets {
  const nums = raws.map(parseNum).filter((n): n is number => n !== null);
  const distinct = new Set(nums);
  const hasEmpty = raws.some((r) => parseNum(r) === null);

  // Few distinct values = a rating, a year, a count of children. Ranges would lie.
  if (distinct.size <= NUMBER_AS_LABEL_MAX) {
    const keys = new Map<string, BucketKey>();
    const counts = new Map<string, number>();
    for (const n of [...distinct].sort((a, b) => a - b)) {
      const k = fmtNum(n);
      keys.set(k, { key: k, tone: "neutral", sort: n });
    }
    for (const r of raws) {
      const n = parseNum(r);
      const k = n === null ? EMPTY_KEY : fmtNum(n);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    if (hasEmpty) keys.set(EMPTY_KEY, { key: EMPTY_KEY, tone: "neutral", sort: Number.MAX_SAFE_INTEGER });
    return {
      mode: "label",
      keys: orderKeys(keys, counts, true),
      keyOf: (raw: string) => {
        const n = parseNum(raw);
        return [n === null ? EMPTY_KEY : fmtNum(n)];
      },
    };
  }

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const step = niceStep((max - min) / TARGET_BINS) || 1;
  const base = Math.floor(min / step) * step;
  const binOf = (n: number) => Math.floor((n - base) / step);
  const labelOfBin = (b: number) => rangeLabel(base + b * step, base + (b + 1) * step);

  const keys = new Map<string, BucketKey>();
  const counts = new Map<string, number>();
  for (const r of raws) {
    const n = parseNum(r);
    if (n === null) {
      counts.set(EMPTY_KEY, (counts.get(EMPTY_KEY) ?? 0) + 1);
      keys.set(EMPTY_KEY, { key: EMPTY_KEY, tone: "neutral", sort: Number.MAX_SAFE_INTEGER });
      continue;
    }
    const b = binOf(n);
    const k = labelOfBin(b);
    keys.set(k, { key: k, tone: "neutral", sort: base + b * step });
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  return {
    mode: "number",
    keys: orderKeys(keys, counts, true),
    keyOf: (raw: string) => {
      const n = parseNum(raw);
      return [n === null ? EMPTY_KEY : labelOfBin(binOf(n))];
    },
  };
}

/* ------------------------------------------------------------------ date */

const DAY = 86400000;

function dateBuckets(col: Col, raws: string[]): Buckets {
  void col;
  const stamps = raws.map((r) => parseBoardDate(r)?.at ?? null);
  const real = stamps.filter((s): s is number => s !== null);

  // The grain follows the real span: a year of data is months; a decade is years.
  let grain: DateGrain = "month";
  if (real.length) {
    const spanDays = (Math.max(...real) - Math.min(...real)) / DAY;
    grain = spanDays > 366 * 4 ? "year" : spanDays > 366 ? "quarter" : "month";
  }

  const keys = new Map<string, BucketKey>();
  const counts = new Map<string, number>();
  for (const s of stamps) {
    if (s === null) {
      keys.set(EMPTY_KEY, { key: EMPTY_KEY, tone: "neutral", sort: Number.MAX_SAFE_INTEGER });
      counts.set(EMPTY_KEY, (counts.get(EMPTY_KEY) ?? 0) + 1);
      continue;
    }
    const { key, sort } = dateKey(s, grain);
    keys.set(key, { key, tone: "neutral", sort });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return {
    mode: "date",
    grain,
    keys: orderKeys(keys, counts, true),
    keyOf: (raw: string) => {
      const p = parseBoardDate(raw);
      return [p ? dateKey(p.at, grain).key : EMPTY_KEY];
    },
  };
}
