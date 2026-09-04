import type { MondayBoard, MondayItem, AIAnalysis } from "@/types";

// NOTE: The Monday token is resolved SERVER-SIDE from the logged-in user's org.
// These helpers no longer send a token — the `apiToken` params are kept only so
// existing callers/components don't need to be rewired, and are ignored.

export async function loadBoard(boardId: string, _apiToken?: string): Promise<{
  board: MondayBoard;
  items: MondayItem[];
}> {
  const res = await fetch("/api/monday", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "board", boardId }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export async function listBoards(_apiToken?: string): Promise<{ id: string; name: string; items_count: number; description: string }[]> {
  const res = await fetch("/api/monday", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list_boards" }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.boards;
}

export async function changeColumnValue(
  boardId: string, _apiToken: string, itemId: string, columnId: string, value: unknown
): Promise<void> {
  const res = await fetch("/api/monday", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "change_value", boardId, itemId, columnId, value }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
}

export async function changeSimpleValue(
  boardId: string, _apiToken: string, itemId: string, columnId: string, value: string
): Promise<void> {
  const res = await fetch("/api/monday", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "change_simple", boardId, itemId, columnId, value }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
}

export async function createItem(
  boardId: string, _apiToken: string, itemName: string, groupId?: string
): Promise<{ id: string; name: string }> {
  const res = await fetch("/api/monday", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create_item", boardId, itemName, groupId }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.item;
}

export async function analyzeBoardAI(boardId: string): Promise<AIAnalysis> {
  // The server reads the board itself by id — the browser sends no board data.
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ boardId }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

/** Ask the server whether the current user's org is connected to Monday. */
export async function getMondayStatus(): Promise<{
  configured: boolean;
  authed: boolean;
  connected: boolean;
  orgName?: string;
  accountName?: string | null;
  /** Is the paste-a-personal-token route open? Absent answer = closed. */
  personalToken?: boolean;
}> {
  const res = await fetch("/api/monday/status", { cache: "no-store" });
  return res.json();
}

/** Disconnect Monday for the current org. */
export async function disconnectMonday(): Promise<void> {
  await fetch("/api/monday/disconnect", { method: "POST" });
}
