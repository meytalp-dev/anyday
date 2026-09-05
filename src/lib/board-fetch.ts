// One place that reads a Monday board's items — WITH PAGINATION.
//
// Monday returns items one page at a time (max 500). Asking for a single page
// and treating it as "the board" silently turns every percentage into a lie on
// any board bigger than that page. So we walk the cursor to the end (up to a
// safety cap) and report exactly how much we actually read, so the UI can say
// so instead of pretending.
import { mondayQuery } from "./monday-server";
import { columnMentioned } from "./board-profile";
import { isFilled, type BoardFill } from "./column-coverage";
import type { Board as BIBoard, Col, ItemVal } from "./board-intelligence";

const PAGE = 500;                       // Monday's per-page maximum
const DEFAULT_MAX = Number(process.env.ANYDAY_MAX_ITEMS || 2000);

export interface FetchedItem { id: string; name: string; updatedAt: string; values: ItemVal[]; }

export interface FetchedBoard extends BIBoard {
  items: FetchedItem[];
  itemsCount: number;  // the real total, as Monday reports it
  loaded: number;      // how many we actually read
  truncated: boolean;  // true = there are more items we did NOT read
}

export interface Coverage { loaded: number; total: number; truncated: boolean; note: string; }

const ITEM_FIELDS = `items { id name updated_at column_values { id text column { title type } } }`;

interface RawCV { id: string; text: string | null; column?: { title: string; type: string } }
interface RawItem { id: string; name: string; updated_at?: string; column_values?: RawCV[] }

function mapItems(raw: RawItem[] | undefined): FetchedItem[] {
  return (raw || []).map((it) => ({
    id: it.id,
    name: it.name,
    updatedAt: it.updated_at || "",
    values: (it.column_values || []).map((cv) => ({
      colId: cv.id,
      title: cv.column?.title || "",
      type: cv.column?.type || "",
      text: cv.text || "",
    })),
  }));
}

/**
 * Board ids arrive from cookies and from `?boards=` — i.e. partly from the
 * client. Monday ids are numeric, so anything else is dropped rather than
 * passed on.
 */
export function parseBoardIds(raw: string | null | undefined, max = 4): string[] {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .slice(0, max);
}

/** Read the given boards in full (columns + all items, up to the cap). */
export async function fetchBoards(
  ids: string[],
  token: string,
  opts: { maxItems?: number } = {}
): Promise<FetchedBoard[]> {
  if (!ids.length) return [];
  const max = Math.max(PAGE, opts.maxItems ?? DEFAULT_MAX);

  const first = await mondayQuery(
    `query ($ids:[ID!], $limit:Int!) {
       boards(ids:$ids) {
         id name items_count
         columns { id title type settings_str }
         items_page(limit:$limit) { cursor ${ITEM_FIELDS} }
       }
     }`,
    token,
    { ids, limit: PAGE }
  );

  const out: FetchedBoard[] = [];
  for (const rb of (first?.boards || []) as RawBoard[]) {
    const items = mapItems(rb.items_page?.items);
    let cursor: string | null = rb.items_page?.cursor ?? null;

    while (cursor && items.length < max) {
      const page = await mondayQuery(
        `query ($cursor:String!, $limit:Int!) {
           next_items_page(cursor:$cursor, limit:$limit) { cursor ${ITEM_FIELDS} }
         }`,
        token,
        { cursor, limit: PAGE }
      );
      items.push(...mapItems(page?.next_items_page?.items));
      cursor = page?.next_items_page?.cursor ?? null;
    }

    out.push({
      id: rb.id,
      name: rb.name,
      columns: (rb.columns || []) as Col[],
      items,
      itemsCount: typeof rb.items_count === "number" ? rb.items_count : items.length,
      loaded: items.length,
      truncated: Boolean(cursor),   // we stopped at the cap with more left
    });
  }
  return out;
}

interface RawBoard {
  id: string; name: string; items_count?: number;
  columns?: Col[];
  items_page?: { cursor: string | null; items: RawItem[] };
}

/** How much of the data the answer is actually based on — for honest UI.
 *  Only the three counters are read, so the parameter asks for only those: a
 *  stored spreadsheet reports coverage too, and it has no Monday item shape. */
export function coverage(boards: { loaded: number; itemsCount: number; truncated: boolean }[]): Coverage {
  const loaded = boards.reduce((s, b) => s + b.loaded, 0);
  const total = boards.reduce((s, b) => s + Math.max(b.itemsCount, b.loaded), 0);
  const truncated = boards.some((b) => b.truncated);
  return {
    loaded,
    total,
    truncated,
    note: truncated ? `מבוסס על ${loaded} מתוך ${total} רשומות` : "",
  };
}

/**
 * Columns ONLY — no items. Used by the "meta" mode of /api/dashboard, which
 * needs each status column's label→color settings (and the board name) in
 * order to hand the browser a language-independent tone map. Reading items is
 * still the exclusive job of fetchBoards(); this never touches items_page.
 */
export async function fetchBoardMeta(
  ids: string[],
  token: string
): Promise<BIBoard[]> {
  if (!ids.length) return [];
  const res = await mondayQuery(
    `query ($ids:[ID!]) {
       boards(ids:$ids) { id name columns { id title type settings_str } }
     }`,
    token,
    { ids }
  );
  return ((res?.boards || []) as RawBoard[]).map((rb) => ({
    id: rb.id,
    name: rb.name,
    columns: (rb.columns || []) as Col[],
    items: [],
  }));
}

/* ------------------------------------------------- one column, many boards */

/** Run `n` at a time — enough to keep the wizard responsive, few enough that
 *  ten boards do not arrive at Monday's rate limiter as one burst. */
async function mapLimit<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]);
    })
  );
  return out;
}

/**
 * How full is ONE column, across several boards — reading that column only.
 *
 * This is what lets the wizard say "מלא ב-25%" BEFORE the dashboard is built
 * (מיטל, 5.9). It is deliberately not fetchBoards(): that reads every column of
 * every row, and measuring one column's fill across ten school boards does not
 * justify pulling ten boards whole. Each board is resolved to ITS OWN spelling
 * of the column, the same way the render will resolve it, so the number shown
 * is measured on the cells the dashboard will actually draw.
 *
 * A board with no matching column is returned in `missing`, by name — never
 * dropped into the average. Rows beyond the cap are reported through
 * `itemsCount > rows`, which is what marks the percentage as a sample.
 */
export async function fetchColumnFill(
  boardIds: string[],
  columnQuery: string,
  token: string,
  opts: { maxItems?: number } = {}
): Promise<{ fills: BoardFill[]; missing: string[] }> {
  if (!boardIds.length || !columnQuery.trim()) return { fills: [], missing: [] };
  const max = Math.max(PAGE, opts.maxItems ?? DEFAULT_MAX);

  const meta = await mondayQuery(
    `query ($ids:[ID!]) {
       boards(ids:$ids) { id name items_count columns { id title } }
     }`,
    token,
    { ids: boardIds }
  );

  const missing: string[] = [];
  const targets: { id: string; name: string; itemsCount: number; colId: string; colTitle: string }[] = [];
  for (const rb of (meta?.boards || []) as RawBoard[]) {
    const cols = (rb.columns || []) as { id: string; title: string }[];
    // Exact spelling first, the product's flexible match second — the order
    // resolveColumn uses, so a board never measures one column and renders another.
    const col =
      cols.find((c) => c.title.trim() === columnQuery.trim()) ??
      cols.find((c) => columnMentioned(c.title, columnQuery) || columnMentioned(columnQuery, c.title));
    if (!col) { missing.push(rb.name); continue; }
    targets.push({
      id: rb.id, name: rb.name,
      itemsCount: typeof rb.items_count === "number" ? rb.items_count : 0,
      colId: col.id, colTitle: col.title,
    });
  }

  const fills = await mapLimit(targets, 3, async (t): Promise<BoardFill> => {
    let rows = 0;
    let filled = 0;
    let cursor: string | null = null;

    const count = (items: { column_values?: { id: string; text: string | null }[] }[] | undefined) => {
      for (const it of items || []) {
        rows++;
        const cv = (it.column_values || []).find((v) => v.id === t.colId) ?? (it.column_values || [])[0];
        if (isFilled(cv?.text)) filled++;
      }
    };

    // `column_values(ids:)` is the whole point — one cell per row instead of the
    // row. If a Monday version rejects the argument, fall back to reading the
    // row's cells and picking ours out, rather than returning no number at all.
    let byId = true;
    const firstPage = async () => {
      const q = byId
        ? `query ($ids:[ID!], $cols:[String!], $limit:Int!) {
             boards(ids:$ids) { items_page(limit:$limit) { cursor items { column_values(ids:$cols) { id text } } } }
           }`
        : `query ($ids:[ID!], $limit:Int!) {
             boards(ids:$ids) { items_page(limit:$limit) { cursor items { column_values { id text } } } }
           }`;
      return mondayQuery(q, token, byId
        ? { ids: [t.id], cols: [t.colId], limit: PAGE }
        : { ids: [t.id], limit: PAGE });
    };

    let page;
    try {
      page = await firstPage();
    } catch {
      byId = false;
      page = await firstPage();
    }
    const p0 = (page?.boards?.[0]?.items_page ?? null) as { cursor: string | null; items: { column_values?: { id: string; text: string | null }[] }[] } | null;
    count(p0?.items);
    cursor = p0?.cursor ?? null;

    while (cursor && rows < max) {
      const q: string = byId
        ? `query ($cursor:String!, $cols:[String!], $limit:Int!) {
             next_items_page(cursor:$cursor, limit:$limit) { cursor items { column_values(ids:$cols) { id text } } }
           }`
        : `query ($cursor:String!, $limit:Int!) {
             next_items_page(cursor:$cursor, limit:$limit) { cursor items { column_values { id text } } }
           }`;
      const nxt = await mondayQuery(q, token, byId
        ? { cursor, cols: [t.colId], limit: PAGE }
        : { cursor, limit: PAGE });
      count(nxt?.next_items_page?.items);
      cursor = nxt?.next_items_page?.cursor ?? null;
    }

    return {
      boardId: t.id, boardName: t.name, colTitle: t.colTitle,
      rows, filled,
      // What we read IS the total when we reached the end; otherwise Monday's
      // own count, so the caller can see the percentage is a sample.
      itemsCount: cursor ? Math.max(t.itemsCount, rows) : rows,
    };
  });

  return { fills, missing };
}
