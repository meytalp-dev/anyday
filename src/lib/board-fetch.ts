// One place that reads a Monday board's items — WITH PAGINATION.
//
// Monday returns items one page at a time (max 500). Asking for a single page
// and treating it as "the board" silently turns every percentage into a lie on
// any board bigger than that page. So we walk the cursor to the end (up to a
// safety cap) and report exactly how much we actually read, so the UI can say
// so instead of pretending.
import { mondayQuery } from "./monday-server";
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
