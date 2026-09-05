import { NextRequest, NextResponse } from "next/server";
import { mondayQuery, requireRole } from "@/lib/monday-server";
import { parseBoardDate } from "@/lib/board-intelligence";

/**
 * Full record management that writes to the REAL Monday board.
 *   POST {op:"update", boardId, itemId, columnId, columnType, value}  → edit a field
 *   POST {op:"create", boardId, name, values?}                        → add a record
 *   POST {op:"delete", itemId}                                        → delete a record
 *   POST {op:"import", boardId, rows:[{name, values}]}                → bulk add
 * Generic — value formatting is chosen by the Monday column TYPE, so it works
 * for any board/column of any nonprofit.
 *
 * Every value here comes from the browser, so all of it travels as GraphQL
 * VARIABLES: a name with a quote or a newline is then just text, never part of
 * the query. (This endpoint can delete real records — it must not be sprayable.)
 */

/** One cell of an imported row: which board column, its type, and the raw text. */
interface CellIn { columnId?: unknown; type?: unknown; value?: unknown }
interface RowIn { name?: unknown; values?: unknown }

/** How many rows one import request is allowed to write (protection cap). */
const IMPORT_MAX = 200;

export async function POST(req: NextRequest) {
  // רשומות נכתבות ונמחקות מהבורד האמיתי, ולכן צופה לא נכנס לכאן.
  const guard = await requireRole("member");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const b = await req.json().catch(() => ({}));
  const { op } = b;

  try {
    if (op === "update") {
      const { boardId, itemId, columnId, columnType, value } = b;
      if (!boardId || !itemId || !columnId) return NextResponse.json({ error: "חסרים פרטים" }, { status: 400 });
      await mondayQuery(
        `mutation ($board:ID!, $item:ID!, $column:String!, $value:JSON!) {
           change_column_value(board_id:$board, item_id:$item, column_id:$column, value:$value) { id }
         }`,
        guard.token,
        { board: String(boardId), item: String(itemId), column: String(columnId), value: formatValue(columnType, value) }
      );
      return NextResponse.json({ ok: true });
    }

    if (op === "create") {
      const { boardId, name, values } = b;
      if (!boardId || !name) return NextResponse.json({ error: "חסר שם" }, { status: 400 });
      const data = await mondayQuery(
        `mutation ($board:ID!, $name:String!, $vals:JSON!) {
           create_item(board_id:$board, item_name:$name, column_values:$vals) { id name }
         }`,
        guard.token,
        { board: String(boardId), name: String(name), vals: columnValues(values) }
      );
      return NextResponse.json({ ok: true, item: data.create_item });
    }

    if (op === "delete") {
      const { itemId } = b;
      if (!itemId) return NextResponse.json({ error: "חסר מזהה" }, { status: 400 });
      await mondayQuery(
        `mutation ($item:ID!) { delete_item(item_id:$item) { id } }`,
        guard.token,
        { item: String(itemId) }
      );
      return NextResponse.json({ ok: true });
    }

    /**
     * Bulk import. Each row carries its own cells, already matched to real
     * board columns by the browser AND approved there by the user — this route
     * never guesses which column a file column belongs to.
     *
     * The report it returns is the truth, not a rounding of it: rows that were
     * created, rows that Monday refused (with its reason), and rows that were
     * dropped for having no name. Nothing is swallowed.
     */
    if (op === "import") {
      const { boardId, rows } = b as { boardId?: unknown; rows?: unknown };
      if (!boardId || !Array.isArray(rows) || !rows.length)
        return NextResponse.json({ error: "אין שורות לייבוא" }, { status: 400 });

      const all = rows as RowIn[];
      const considered = all.slice(0, IMPORT_MAX);
      const overCap = all.length - considered.length;

      let created = 0, noName = 0;
      const failures: { name: string; reason: string }[] = [];

      for (const row of considered) {
        const name = typeof row?.name === "string" ? row.name.trim() : "";
        if (!name) { noName++; continue; }
        try {
          await mondayQuery(
            `mutation ($board:ID!, $name:String!, $vals:JSON!) {
               create_item(board_id:$board, item_name:$name, column_values:$vals) { id }
             }`,
            guard.token,
            { board: String(boardId), name, vals: columnValues(row?.values) }
          );
          created++;
        } catch (e) {
          failures.push({ name, reason: e instanceof Error ? e.message : "שגיאה לא ידועה" });
        }
      }

      return NextResponse.json({
        ok: true,
        created,
        failed: failures.length,
        noName,
        overCap,
        attempted: considered.length,
        limit: IMPORT_MAX,
        failures: failures.slice(0, 10),
      });
    }

    return NextResponse.json({ error: "op לא תקין" }, { status: 400 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאה" }, { status: 502 });
  }
}

/**
 * Build Monday's `column_values` payload for one item: {columnId: value}, where
 * each value is shaped by its column TYPE via formatValue — the same single
 * formatter the edit path uses, so import and edit can never drift apart.
 * The result is passed as a GraphQL variable, never spliced into the query.
 */
function columnValues(values: unknown): string {
  const out: Record<string, unknown> = {};
  if (Array.isArray(values)) {
    for (const cell of values as CellIn[]) {
      const columnId = typeof cell?.columnId === "string" ? cell.columnId : "";
      const value = cell?.value == null ? "" : String(cell.value);
      if (!columnId || !value.trim()) continue;   // empty cell = leave the column alone
      const formatted = formatValue(String(cell?.type ?? ""), value);
      try { out[columnId] = JSON.parse(formatted); } catch { out[columnId] = value; }
    }
  }
  return JSON.stringify(out);
}

/** Format a value into Monday's JSON-string per column type. */
function formatValue(type: string, value: string): string {
  switch (type) {
    case "status":
    case "color": return JSON.stringify({ label: value });
    case "dropdown": return JSON.stringify({ labels: [value] });
    case "date": {
      /* Monday מקבל רק YYYY-MM-DD. משתמשת שמקלידה "25.1.2026" קיבלה עד עכשיו
         שגיאה עמומה ממונדיי (או שקט). parseBoardDate מנרמל כל צורה שהמוצר
         כבר יודע לקרוא; מה שלא-תאריך עובר כמו שהוא, כדי שמונדיי יסרב בקול
         במקום שאנחנו נבלע את הערך בשקט. */
      const p = parseBoardDate(value);
      return JSON.stringify({ date: p ? p.iso : value });
    }
    case "numbers": return JSON.stringify(value);
    case "checkbox": return JSON.stringify({ checked: value ? "true" : "false" });
    case "email": return JSON.stringify({ email: value, text: value });
    case "phone": return JSON.stringify({ phone: value, countryShortName: "IL" });
    case "link": return JSON.stringify({ url: value, text: value });
    case "text":
    case "long_text":
    default: return JSON.stringify(value);
  }
}
