import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { mondayQuery, requireRole } from "@/lib/monday-server";
import { fetchBoards, parseBoardIds } from "@/lib/board-fetch";
import {
  resolveName, valueCandidates, matchLabel, escapeHtml, labelsByColumn, STATUS_COLUMNS_QUERY,
} from "@/lib/chat-intent";

/**
 * Chat-driven WRITE actions on Monday, always in two steps:
 *   1) POST {mode:"preview", ...}  → returns exactly what will change (no write)
 *   2) POST {mode:"apply", ...}    → performs the mutation
 * Generic: works by finding the right item + status-type column by TYPE, not
 * by hard-coded names, so it fits any nonprofit's board.
 *
 * The status text comes from a free-text chat message, so the write travels as
 * a GraphQL variable rather than being pasted into the mutation string.
 */
export async function POST(req: NextRequest) {
  // הפעולה משנה סטטוס בבורד האמיתי, ולכן צופה לא נכנס לכאן.
  const guard = await requireRole("member");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const { mode, personName, newStatus, boardId, itemId, columnId, columnTitle } = body;

  const selected = parseBoardIds((await cookies()).get("anyday_selected_boards")?.value);
  if (!selected.length) return NextResponse.json({ error: "בחרו בורד" }, { status: 400 });

  // ── PREVIEW: find the person + the status column, return the plan ──
  if (mode === "preview") {
    if (!personName || !newStatus) return NextResponse.json({ error: "חסר שם או סטטוס" }, { status: 400 });
    try {
      const boards = await fetchBoards(selected, guard.token);
      const pool = boards.filter((b) => b.columns.some((c) => ["status", "color"].includes(c.type)));
      const found = resolveName(
        String(personName),
        pool.map((b) => ({ id: b.id, name: b.name, items: b.items.map((it) => ({ id: it.id, name: it.name })) })),
      );

      if (found.kind === "none") {
        return NextResponse.json({ found: false, message: `לא מצאתי את "${personName}" בבורדים שבחרתם, או שאין עמודת סטטוס.` });
      }
      // More than one item answers to that name — never pick one silently.
      if (found.kind === "many") {
        const candidates = found.matches.map((m) => m.item.name);
        return NextResponse.json({
          found: false,
          ambiguous: true,
          candidates,
          message: `ל"${personName}" יש יותר מהתאמה אחת: ${candidates.slice(0, 8).join(" · ")}. לא שיניתי כלום — ציינו את השם המלא.`,
        });
      }

      const { item, board } = found.matches[0];
      const full = boards.find((b) => b.id === board.id)!;
      const statusCol = full.columns.find((c) => ["status", "color"].includes(c.type))!;
      const fullItem = full.items.find((it) => it.id === item.id);
      const current = fullItem?.values.find((cv) => cv.colId === statusCol.id)?.text || "—";

      // The value must be one the column actually offers, or nothing is written.
      const allowed = (await statusLabels(full.id, guard.token))[statusCol.id] || [];
      let value = String(newStatus);
      if (allowed.length) {
        const hit = matchLabel(valueCandidates(value), allowed);
        if (!hit) {
          return NextResponse.json({
            found: false,
            unknownValue: true,
            labels: allowed,
            message: `"${value}" לא קיים בעמודה "${statusCol.title}". הערכים שקיימים בה: ${allowed.join(" · ")}.`,
          });
        }
        value = hit;
      }

      return NextResponse.json({
        found: true,
        labels: allowed,
        preview: { personName: item.name, boardId: full.id, boardName: full.name, itemId: item.id, columnId: statusCol.id, columnTitle: statusCol.title, from: current, to: value },
      });
    } catch (e: unknown) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאה" }, { status: 502 });
    }
  }

  // ── APPLY: perform the change ──
  if (mode === "apply") {
    if (!boardId || !itemId || !columnId || !newStatus) return NextResponse.json({ error: "חסרים פרטים" }, { status: 400 });
    try {
      // Last stop before the write: the label must exist on that column.
      // Otherwise Monday answers with a raw English GraphQL error, which used
      // to be shown to the user as-is.
      const allowed = (await statusLabels(String(boardId), guard.token))[String(columnId)] || [];
      let value = String(newStatus);
      if (allowed.length) {
        const hit = matchLabel(valueCandidates(value), allowed);
        if (!hit) {
          return NextResponse.json({
            error: `"<b>${escapeHtml(value)}</b>" לא קיים בעמודה <b>${escapeHtml(String(columnTitle || ""))}</b>, אז לא שיניתי כלום. הערכים שקיימים בה: ${allowed.map((l) => `<b>${escapeHtml(l)}</b>`).join(" · ")}.`,
          }, { status: 400 });
        }
        value = hit;   // write the board's own spelling
      }

      await mondayQuery(
        `mutation ($board:ID!, $item:ID!, $column:String!, $value:JSON!) {
           change_column_value(board_id:$board, item_id:$item, column_id:$column, value:$value) { id }
         }`,
        guard.token,
        {
          board: String(boardId),
          item: String(itemId),
          column: String(columnId),
          value: JSON.stringify({ label: value }),
        }
      );
      return NextResponse.json({ ok: true, message: `עודכן: ${columnTitle || "סטטוס"} → ${value}` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "שגיאה";
      return NextResponse.json({ error: `העדכון נכשל: ${msg}` }, { status: 502 });
    }
  }

  return NextResponse.json({ error: "mode לא תקין" }, { status: 400 });
}

/**
 * A board's status columns and the labels each one actually allows.
 *
 * DEBT (see anyday-ops/reports/T1.md): `board-fetch.ts` reads the same columns
 * but drops `settings_str`, and it is owned by another task right now — so this
 * one small query lives here (and in api/ask) until the two can be merged.
 */
async function statusLabels(boardId: string, token: string): Promise<Record<string, string[]>> {
  try {
    const data = await mondayQuery(STATUS_COLUMNS_QUERY, token, { ids: [String(boardId)] });
    return labelsByColumn(data);
  } catch {
    return {};   // labels unavailable → skip validation rather than block the write
  }
}
