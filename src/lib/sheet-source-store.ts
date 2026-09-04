// Reading and refreshing SAVED spreadsheets on the server.
//
// The store is deliberately thin: it fetches a row, hands back the stored
// contract from lib/sheet-source, and — for a linked sheet — can go and read
// the sheet again. Everything that decides anything lives in the pure module
// beside it.
//
// A 'file' source is frozen by definition: nobody can re-read a file that was
// dragged into a tab last week. A 'link' source refreshes, and that is the
// difference the screen must state rather than let a stale number look live.

import { createServiceClient } from "./supabase-server";
import { csvUrlFor } from "./sheets-url";
import { sanitizeSheetSource, sourceToBoard, MAX_STORED_CSV, type StoredSheetSource } from "./sheet-source";
import type { Board } from "./board-intelligence";

export interface SheetSourceRow extends StoredSheetSource {
  id: string;
  fetchedAt: string;
}

/** One saved sheet, scoped to the org. Null when it is not this org's. */
export async function readSheetSource(orgId: string, id: string): Promise<SheetSourceRow | null> {
  const service = createServiceClient();
  if (!service) return null;
  const { data, error } = await service
    .from("sheet_sources")
    .select("id, title, kind, url, csv, type_overrides, fetched_at")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error || !data) return null;

  // Round-trip through the same sanitizer that guarded the write: a row edited
  // by any other route is still only allowed to say what the contract allows.
  const clean = sanitizeSheetSource({
    title: data.title, kind: data.kind, url: data.url,
    csv: data.csv, typeOverrides: data.type_overrides,
  });
  if (!clean) return null;
  return { ...clean, id: data.id as string, fetchedAt: data.fetched_at as string };
}

/** The saved sheet as a Board — what every other part of the engine speaks. */
export async function sheetSourceBoard(orgId: string, id: string): Promise<Board | null> {
  const row = await readSheetSource(orgId, id);
  return row ? sourceToBoard(row) : null;
}

/**
 * Re-read a linked sheet and store what came back.
 *
 * Returns the fresh board, or a reason. A failure deliberately does NOT clear
 * the stored csv: a dashboard showing last week's numbers with a date on it
 * beats a dashboard showing nothing, and the caller says which it got.
 */
export async function refreshSheetSource(
  orgId: string, id: string
): Promise<{ ok: true; board: Board | null; fetchedAt: string } | { ok: false; error: string }> {
  const row = await readSheetSource(orgId, id);
  if (!row) return { ok: false, error: "המקור לא נמצא" };
  if (row.kind !== "link" || !row.url) {
    return { ok: false, error: "מקור שהועלה כקובץ אינו ניתן למשיכה מחדש — אין מאיפה למשוך." };
  }

  const target = csvUrlFor(row.url);
  if ("bad" in target) return { ok: false, error: target.bad };

  let res: Response;
  try {
    res = await fetch(target.url, { redirect: "follow", signal: AbortSignal.timeout(15000), cache: "no-store" });
  } catch {
    return { ok: false, error: "Google לא ענה בזמן." };
  }
  // A private sheet does not FAIL — Google answers 200 with a login page.
  const type = res.headers.get("content-type") || "";
  if (!res.ok || type.includes("text/html")) return { ok: false, error: "אין יותר גישה לגיליון." };
  const csv = await res.text();
  if (csv.trim().startsWith("<")) return { ok: false, error: "אין יותר גישה לגיליון." };
  if (csv.length > MAX_STORED_CSV) return { ok: false, error: "הגיליון גדל מעבר למה שניתן לשמור." };

  const service = createServiceClient();
  if (!service) return { ok: false, error: "אחסון לא זמין" };
  const fetchedAt = new Date().toISOString();
  const { error } = await service
    .from("sheet_sources")
    .update({ csv, fetched_at: fetchedAt })
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) return { ok: false, error: error.message };

  return { ok: true, board: sourceToBoard({ ...row, csv }), fetchedAt };
}

/**
 * The org's saved spreadsheets, ready for the weekly digest.
 *
 * This is where "automations on a sheet" actually happens (הכרעת מיטל 4.9).
 * A LINKED sheet is re-read first, so Sunday's email reports Sunday's numbers
 * rather than whatever was true when somebody last opened the tab. A refetch
 * that fails is not fatal: the stored copy still produces a correct email
 * about an older moment, which beats sending nothing — the caller gets
 * `stale: true` so the email can say which it is.
 *
 * An uploaded FILE is frozen by definition and is never marked stale: it is
 * not out of date, it is simply all there ever was.
 */
export async function digestSheetBoards(
  orgId: string,
  ids: string[]
): Promise<{ board: Board; title: string; stale: boolean; fetchedAt: string }[]> {
  const out: { board: Board; title: string; stale: boolean; fetchedAt: string }[] = [];
  for (const id of ids.slice(0, 20)) {
    const row = await readSheetSource(orgId, id);
    if (!row) continue;

    if (row.kind === "link") {
      const fresh = await refreshSheetSource(orgId, id);
      if (fresh.ok && fresh.board) {
        out.push({ board: fresh.board, title: row.title, stale: false, fetchedAt: fresh.fetchedAt });
        continue;
      }
      const board = sourceToBoard(row);
      if (board) out.push({ board, title: row.title, stale: true, fetchedAt: row.fetchedAt });
      continue;
    }

    const board = sourceToBoard(row);
    if (board) out.push({ board, title: row.title, stale: false, fetchedAt: row.fetchedAt });
  }
  return out;
}
