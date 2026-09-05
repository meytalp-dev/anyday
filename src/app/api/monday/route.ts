import { NextRequest, NextResponse } from "next/server";
import { mondayQuery as mondayQueryWithToken, requireMonday } from "@/lib/monday-server";
import { atLeast, forbiddenMessage } from "@/lib/roles";

/**
 * This route is a multiplexer: some actions read the board, some change it.
 * A blanket role gate at the top would stop a viewer from READING, which is
 * exactly what a viewer is for — so the gate is per action, and the list below
 * is the one place that says which of them touch the customer's real data.
 *
 * Anything not listed is treated as a read. That is the safe direction here
 * only because an unlisted action does not exist; a NEW writing action must be
 * added to this set in the same commit that adds it.
 */
const WRITING_ACTIONS = new Set([
  "automate", "archive_item", "change_value", "change_simple",
  "create_item", "create_board",
]);

export async function POST(req: NextRequest) {
  try {
    // Resolve the token from the logged-in user's org — never from the client.
    const guard = await requireMonday();
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }
    const apiToken = guard.token;
    /* `variables` is optional and forwarded untouched. Every existing call site
       passes one argument, so `variables` is `undefined` there and
       mondayQueryWithToken sends the very same `{ query }` body as before. */
    const mondayQuery = (query: string, variables?: Record<string, unknown>) =>
      mondayQueryWithToken(query, apiToken, variables);

    const body = await req.json();
    const { action, boardId } = body;

    if (WRITING_ACTIONS.has(action) && !atLeast(guard.role, "member")) {
      return NextResponse.json({ error: forbiddenMessage("member") }, { status: 403 });
    }

    if (action === "board") {
      if (!boardId) {
        return NextResponse.json({ error: "נא להזין מספר בורד" }, { status: 400 });
      }

      const data = await mondayQuery(
        `query ($boardId: ID!) { boards(ids:[$boardId]) { id name description items_count columns { id title type } items_page(limit:100) { items { id name column_values { id text column { title type } } } } } }`,
        { boardId }
      );

      const board = data.boards?.[0];
      if (!board) {
        return NextResponse.json({ error: "בורד לא נמצא. בדקי שמספר הבורד נכון." }, { status: 404 });
      }

      const items = board.items_page?.items || [];
      delete board.items_page;

      return NextResponse.json({ board, items });
    }

    // ── Execute automation: scan items + apply action on matches ──
    if (action === "automate") {
      const { conditionColumn, conditionValues, actionType, actionConfig } = body;

      if (!boardId || !conditionColumn || !actionType) {
        return NextResponse.json({ error: "חסרים פרטים לאוטומציה" }, { status: 400 });
      }

      // Fetch all items
      const boardData = await mondayQuery(
        `query ($boardId: ID!) { boards(ids:[$boardId]) { groups { id title } items_page(limit:500) { items { id name column_values { id text value column { title type } } } } } }`,
        { boardId }
      );
      const allItems = boardData.boards?.[0]?.items_page?.items || [];
      const groups = boardData.boards?.[0]?.groups || [];

      // Find matching items
      const matches = allItems.filter((item: { column_values: { id: string; text: string }[] }) => {
        const cv = item.column_values.find((v: { id: string }) => v.id === conditionColumn);
        if (!cv?.text) return false;
        if (conditionValues && conditionValues.length > 0) {
          return conditionValues.includes(cv.text);
        }
        return true;
      });

      if (matches.length === 0) {
        return NextResponse.json({ executed: 0, message: "לא נמצאו פריטים תואמים" });
      }

      let executed = 0;
      const results: string[] = [];

      for (const item of matches) {
        try {
          if (actionType === "change_status") {
            const { columnId, newValue } = actionConfig;
            /* `value` is a JSON scalar: Monday wants the JSON *encoded as a
               string*, which is exactly what the old query built by hand —
               only now without the fragile double-escaping. */
            await mondayQuery(
              `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) { change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id } }`,
              {
                boardId,
                itemId: item.id,
                columnId: String(columnId),
                value: JSON.stringify({ label: newValue }),
              }
            );
            results.push(`${item.name}: סטטוס שונה ל-${newValue}`);
          } else if (actionType === "move_to_group") {
            const { groupId } = actionConfig;
            await mondayQuery(
              `mutation ($itemId: ID!, $groupId: String!) { move_item_to_group(item_id: $itemId, group_id: $groupId) { id } }`,
              { itemId: item.id, groupId: String(groupId) }
            );
            const groupName = groups.find((g: { id: string; title: string }) => g.id === groupId)?.title || groupId;
            results.push(`${item.name}: הועבר ל-${groupName}`);
          } else if (actionType === "notify") {
            const { text } = actionConfig;
            let userId = actionConfig.userId;
            if (!userId) {
              const meRes = await mondayQuery(`query { me { id } }`);
              userId = meRes?.me?.id;
            }
            if (userId) {
              await mondayQuery(
                `mutation ($userId: ID!, $targetId: ID!, $text: String!) { create_notification(user_id: $userId, target_id: $targetId, text: $text, target_type: Project) { text } }`,
                { userId, targetId: item.id, text: String(text || "התראה") }
              );
              results.push(`${item.name}: נשלחה התראה`);
            } else {
              results.push(`${item.name}: לא נמצא משתמש`);
            }
          } else if (actionType === "archive") {
            // stays archive_item — never delete_item
            await mondayQuery(
              `mutation ($itemId: ID!) { archive_item(item_id: $itemId) { id } }`,
              { itemId: item.id }
            );
            results.push(`${item.name}: הועבר לארכיון`);
          } else if (actionType === "send_email") {
            const { to, subject, html } = actionConfig;
            if (to) {
              // Monday doesn't have native email sending via API, but we can create a notification with the content
              const emailText = `מייל ל-${to}: ${subject || "ללא נושא"}`;
              const meRes = await mondayQuery(`query { me { id } }`);
              const uid = meRes?.me?.id;
              if (uid) {
                await mondayQuery(
                  `mutation ($userId: ID!, $targetId: ID!, $text: String!) { create_notification(user_id: $userId, target_id: $targetId, text: $text, target_type: Project) { text } }`,
                  { userId: uid, targetId: item.id, text: emailText }
                );
              }
              results.push(`${item.name}: נשלחה התראת מייל`);
            } else {
              results.push(`${item.name}: חסרה כתובת מייל`);
            }
          } else if (actionType === "create_item") {
            const { itemName, groupId: gId } = actionConfig;
            if (itemName) {
              /* The optional group is switched on/off by a FIXED fragment; the
                 group id itself still travels as a variable. */
              const groupDecl = gId ? ", $groupId: String!" : "";
              const groupClause = gId ? ", group_id: $groupId" : "";
              await mondayQuery(
                `mutation ($boardId: ID!, $itemName: String!${groupDecl}) { create_item(board_id: $boardId, item_name: $itemName${groupClause}) { id } }`,
                { boardId, itemName: String(itemName), ...(gId ? { groupId: String(gId) } : {}) }
              );
              results.push(`נוצר פריט: ${itemName}`);
            }
          }
          executed++;
        } catch (err) {
          results.push(`${item.name}: שגיאה - ${err instanceof Error ? err.message : "unknown"}`);
        }
      }

      return NextResponse.json({ executed, total: matches.length, results });
    }

    // ── Archive a single item ──
    // This replaces the old `mutate` branch, which accepted a whole GraphQL
    // document from the browser and ran it with the org's token — meaning any
    // logged-in client could run ANY operation the token allows (delete_item
    // included). The only thing the product ever sent through it was this one
    // archive, so this one archive is the only thing the server now offers.
    // The document lives here, fixed; the browser supplies an item id, nothing
    // more. Stays archive_item — reversible inside Monday, never delete_item.
    if (action === "archive_item") {
      const { itemId } = body;
      if (!itemId) {
        return NextResponse.json({ error: "missing params" }, { status: 400 });
      }
      const data = await mondayQuery(
        `mutation ($itemId: ID!) { archive_item(item_id: $itemId) { id } }`,
        { itemId: String(itemId) }
      );
      return NextResponse.json({ success: true, data });
    }

    // ── Get groups for a board ──
    if (action === "groups") {
      const data = await mondayQuery(
        `query ($boardId: ID!) { boards(ids:[$boardId]) { groups { id title color } } }`,
        { boardId }
      );
      return NextResponse.json({ groups: data.boards?.[0]?.groups || [] });
    }

    // ── List all boards for the user ──
    if (action === "list_boards") {
      const data = await mondayQuery(
        `query { boards(limit:50, order_by:used_at) { id name items_count description } }`
      );
      return NextResponse.json({ boards: data.boards || [] });
    }

    // ── Change a single column value (structured JSON) ──
    if (action === "change_value") {
      const { itemId, columnId, value } = body;
      if (!boardId || !itemId || !columnId) {
        return NextResponse.json({ error: "missing params" }, { status: 400 });
      }
      const data = await mondayQuery(
        `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) { change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id } }`,
        { boardId, itemId, columnId: String(columnId), value: JSON.stringify(value) }
      );
      return NextResponse.json({ success: true, data });
    }

    // ── Change simple (text) column value ──
    if (action === "change_simple") {
      const { itemId, columnId, value } = body;
      if (!boardId || !itemId || !columnId) {
        return NextResponse.json({ error: "missing params" }, { status: 400 });
      }
      const data = await mondayQuery(
        `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) { change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id } }`,
        { boardId, itemId, columnId: String(columnId), value: String(value) }
      );
      return NextResponse.json({ success: true, data });
    }

    // ── Create new item ──
    if (action === "create_item") {
      const { itemName, groupId } = body;
      if (!boardId || !itemName) {
        return NextResponse.json({ error: "missing params" }, { status: 400 });
      }
      const groupDecl = groupId ? ", $groupId: String!" : "";
      const groupClause = groupId ? ", group_id: $groupId" : "";
      const data = await mondayQuery(
        `mutation ($boardId: ID!, $itemName: String!${groupDecl}) { create_item(board_id: $boardId, item_name: $itemName${groupClause}) { id name } }`,
        { boardId, itemName: String(itemName), ...(groupId ? { groupId: String(groupId) } : {}) }
      );
      return NextResponse.json({ success: true, item: data.create_item });
    }

    // ── Create a new board with columns, groups, and items ──
    if (action === "create_board") {
      const { boardName, boardKind, columns, groups, items } = body;
      if (!boardName) {
        return NextResponse.json({ error: "חסר שם בורד" }, { status: 400 });
      }
      const kind = boardKind === "private" ? "private" : "public";

      // 1. Create the board
      const boardData = await mondayQuery(
        `mutation ($boardName: String!, $boardKind: BoardKind!) { create_board(board_name: $boardName, board_kind: $boardKind) { id } }`,
        { boardName: String(boardName), boardKind: kind }
      );
      const newBoardId = boardData.create_board?.id;
      if (!newBoardId) {
        return NextResponse.json({ error: "שגיאה ביצירת הבורד" }, { status: 500 });
      }

      const results: string[] = [`בורד "${boardName}" נוצר (${newBoardId})`];

      // 2. Create columns
      const columnMap: Record<number, string> = {};
      if (columns && Array.isArray(columns)) {
        for (let i = 0; i < columns.length; i++) {
          const col = columns[i];
          const colTitle = col.title || `עמודה ${i + 1}`;
          const colType = col.type || "text";
          try {
            /* column_type is an enum that also arrived from the browser, so it
               travels as a ColumnType variable too — an unknown type now fails
               loudly instead of being pasted into the query. */
            const colData = await mondayQuery(
              `mutation ($boardId: ID!, $title: String!, $columnType: ColumnType!) { create_column(board_id: $boardId, title: $title, column_type: $columnType) { id } }`,
              { boardId: newBoardId, title: String(colTitle), columnType: String(colType) }
            );
            columnMap[i] = colData.create_column?.id || "";
            results.push(`עמודה: ${col.title} (${colType})`);
          } catch (err) {
            results.push(`שגיאה בעמודה ${col.title}: ${err instanceof Error ? err.message : "unknown"}`);
          }
        }
      }

      // 3. Create groups
      const groupMap: Record<number, string> = {};
      if (groups && Array.isArray(groups)) {
        for (let i = 0; i < groups.length; i++) {
          const grp = groups[i];
          const grpName = grp.title || `קבוצה ${i + 1}`;
          try {
            const grpData = await mondayQuery(
              `mutation ($boardId: ID!, $groupName: String!) { create_group(board_id: $boardId, group_name: $groupName) { id } }`,
              { boardId: newBoardId, groupName: String(grpName) }
            );
            groupMap[i] = grpData.create_group?.id || "";
            results.push(`קבוצה: ${grp.title}`);
          } catch (err) {
            results.push(`שגיאה בקבוצה ${grp.title}: ${err instanceof Error ? err.message : "unknown"}`);
          }
        }
      }

      // 4. Create items
      if (items && Array.isArray(items)) {
        for (const item of items) {
          const itemName = item.name || "פריט חדש";
          const gid = item.group_index !== undefined ? groupMap[item.group_index] : "";
          const groupDecl = gid ? ", $groupId: String!" : "";
          const groupClause = gid ? ", group_id: $groupId" : "";
          try {
            await mondayQuery(
              `mutation ($boardId: ID!, $itemName: String!${groupDecl}) { create_item(board_id: $boardId, item_name: $itemName${groupClause}) { id } }`,
              { boardId: newBoardId, itemName: String(itemName), ...(gid ? { groupId: gid } : {}) }
            );
            results.push(`פריט: ${item.name}`);
          } catch (err) {
            results.push(`שגיאה בפריט ${item.name}: ${err instanceof Error ? err.message : "unknown"}`);
          }
        }
      }

      return NextResponse.json({ success: true, boardId: newBoardId, results });
    }

    return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
