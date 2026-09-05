import { NextRequest, NextResponse } from "next/server";
import type { BuilderBlueprint, BuilderBoard, BuilderColumn } from "@/types/builder";
import { mondayQuery, requireRole } from "@/lib/monday-server";
import { getOrgContext } from "@/lib/session";
import { createServiceClient } from "@/lib/supabase-server";

// Map our ColumnType to Monday's column_type enum
const COLUMN_TYPE_MAP: Record<string, string> = {
  text: "text",
  status: "status",
  people: "people",
  date: "date",
  timeline: "timeline",
  numbers: "numbers",
  dropdown: "dropdown",
  phone: "phone",
  email: "email",
  link: "link",
  long_text: "long_text",
  checkbox: "checkbox",
  color: "color_picker",
  file: "file",
  rating: "rating",
  location: "location",
};

interface BoardResult {
  boardName: string;
  boardId: string | null;
  columns: string[];
  groups: string[];
  error?: string;
}

async function buildBoard(board: BuilderBoard, apiToken: string): Promise<BoardResult> {
  const result: BoardResult = {
    boardName: board.boardName,
    boardId: null,
    columns: [],
    groups: [],
  };

  // 1. Create the board
  // Every client-supplied value travels as a GraphQL variable (RULES §3) —
  // this file used to hand-escape strings into the query text, and the escape
  // was broken (see the columns step below), so a name with a quote could
  // rewrite the mutation running under the org's write-capable token.
  try {
    const data = await mondayQuery(
      `mutation ($boardName: String!) { create_board(board_name: $boardName, board_kind: public) { id } }`,
      apiToken,
      { boardName: board.boardName }
    );
    result.boardId = data.create_board?.id;
  } catch (err) {
    result.error = `Failed to create board: ${err instanceof Error ? err.message : "unknown"}`;
    return result;
  }

  if (!result.boardId) {
    result.error = "Board created but no ID returned";
    return result;
  }

  // 2. Create columns
  for (const col of board.columns) {
    const mondayType = COLUMN_TYPE_MAP[col.type] || "text";
    try {
      // Build defaults for status/dropdown columns. Monday's JSON scalar takes
      // the JSON *encoded as a string* — exactly what the old code built by
      // hand with `.replace(/"/g,'\\"')`, an escape that was demonstrably
      // broken (it ignored backslashes, so a label ending in \ produced an
      // unparsable document). As a variable, no escaping exists to get wrong.
      let defaults: string | undefined;
      if (col.type === "status" && col.statusLabels && col.statusLabels.length > 0) {
        const labels: Record<number, string> = {};
        col.statusLabels.forEach((label, i) => {
          labels[i] = label;
        });
        defaults = JSON.stringify({ labels });
      }
      if (col.type === "dropdown" && col.dropdownOptions && col.dropdownOptions.length > 0) {
        defaults = JSON.stringify({ labels: col.dropdownOptions.map((opt, i) => ({ id: i, name: opt })) });
      }

      /* The optional defaults are switched on/off by a FIXED fragment; the
         value itself still travels as a variable (the create_item pattern). */
      const defaultsDecl = defaults ? ", $defaults: JSON!" : "";
      const defaultsClause = defaults ? ", defaults: $defaults" : "";
      await mondayQuery(
        `mutation ($boardId: ID!, $title: String!, $columnType: ColumnType!${defaultsDecl}) { create_column(board_id: $boardId, title: $title, column_type: $columnType${defaultsClause}) { id } }`,
        apiToken,
        {
          boardId: result.boardId,
          title: col.title,
          columnType: mondayType,
          ...(defaults ? { defaults } : {}),
        }
      );
      result.columns.push(col.title);
    } catch (err) {
      result.columns.push(`${col.title} (error: ${err instanceof Error ? err.message : "unknown"})`);
    }
  }

  // 3. Create groups (Monday creates a default group, so we create ours and the default stays)
  for (const group of board.groups) {
    try {
      await mondayQuery(
        `mutation ($boardId: ID!, $groupName: String!) { create_group(board_id: $boardId, group_name: $groupName) { id } }`,
        apiToken,
        { boardId: result.boardId, groupName: group.title }
      );
      result.groups.push(group.title);
    } catch (err) {
      result.groups.push(`${group.title} (error: ${err instanceof Error ? err.message : "unknown"})`);
    }
  }

  return result;
}

export async function POST(req: NextRequest) {
  try {
    // Auth + Monday connection are resolved server-side; no client token.
    // הפעולה מקימה בורד בחשבון האמיתי, ולכן צופה לא נכנס לכאן.
  const guard = await requireRole("member");
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }
    const apiToken = guard.token;

    const body = await req.json();
    const { blueprint } = body as { blueprint: BuilderBlueprint };

    if (!blueprint || !blueprint.boards || blueprint.boards.length === 0) {
      return NextResponse.json({ error: "Missing blueprint data" }, { status: 400 });
    }

    // Build each board sequentially
    const results: BoardResult[] = [];
    for (const board of blueprint.boards) {
      const boardResult = await buildBoard(board, apiToken);
      results.push(boardResult);
    }

    const successCount = results.filter((r) => r.boardId && !r.error).length;

    // Persist the built blueprint to the org's history (best-effort).
    try {
      const ctx = await getOrgContext();
      const service = createServiceClient();
      if (ctx && service) {
        await service.from("blueprints").insert({
          org_id: ctx.orgId,
          created_by: ctx.userId,
          system_name: blueprint.systemName || "מערכת ללא שם",
          description: blueprint.description ?? null,
          status: "built",
          payload: blueprint as unknown as Record<string, unknown>,
          built_result: { results, successCount, totalBoards: results.length },
          built_at: new Date().toISOString(),
        });
      }
    } catch (persistErr) {
      console.error("Blueprint persist failed:", persistErr);
    }

    return NextResponse.json({
      success: successCount === results.length,
      totalBoards: results.length,
      successCount,
      results,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
