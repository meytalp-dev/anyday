// A SAVED spreadsheet — the contract of what gets stored, and how a Board is
// rebuilt from it on the server.
//
// Meytal's decision (4.9): store the data itself, so automations can run on an
// uploaded sheet. An automation does not need to WRITE anywhere — it needs to
// READ when nobody is looking, and a file dropped into a tab exists only in
// that tab. So a dashboard saved from a sheet has to carry its data with it.
//
// What is stored is the RAW TEXT plus the user's type corrections — never
// parsed rows. That keeps exactly one parser in the system (`readSheet`), and
// it means a correction survives a refetch of a linked sheet, because column
// ids are positional.
//
// Storing is not browsing. Looking at a sheet on /sheet still happens entirely
// in the tab and stores nothing; only SAVING a dashboard puts data here, and
// the screen says so in those words.

import { readSheet, planToBoard, type SheetPlan, type SheetType } from "./sheet-to-board";
import { isReadableSheetLink } from "./sheets-url";
import type { Board } from "./board-intelligence";

/** Browsing allows 20MB; storage is not a disk, so a saved copy is smaller. */
export const MAX_STORED_CSV = 2 * 1024 * 1024;
const MAX_TITLE = 120;
const MAX_URL = 2000;

const SHEET_TYPES: SheetType[] = ["status", "date", "numbers", "text"];

export type SheetSourceKind = "file" | "link";

export interface StoredSheetSource {
  title: string;
  kind: SheetSourceKind;
  /** The sheet's raw text, exactly as the reader received it. */
  csv: string;
  /** Google Sheets link — `link` sources only, and re-readable by definition. */
  url?: string;
  /** Column id -> the type the user corrected it to. */
  typeOverrides?: Record<string, SheetType>;
}

/**
 * Only what the product understands survives, each field bounded.
 *
 * This document is read back by the server and turned into numbers that go out
 * in email, so a free-form blob would be a place to smuggle anything. Returns
 * null when the source is not worth storing at all — an empty sheet, an
 * unknown kind, or a "link" that we would never be willing to fetch.
 */
export function sanitizeSheetSource(raw: unknown): StoredSheetSource | null {
  const r = (raw ?? {}) as Record<string, unknown>;

  const kind = r.kind === "link" ? "link" : r.kind === "file" ? "file" : null;
  if (!kind) return null;

  const csv = typeof r.csv === "string" ? r.csv : "";
  if (!csv.trim()) return null;
  if (csv.length > MAX_STORED_CSV) return null;

  const title = (typeof r.title === "string" ? r.title : "").trim().slice(0, MAX_TITLE) || "גיליון";

  let url: string | undefined;
  if (kind === "link") {
    const u = (typeof r.url === "string" ? r.url : "").trim().slice(0, MAX_URL);
    // The same rule that guards the live fetch guards what we agree to store:
    // a link we would refuse to read is not a source, it is an open redirect
    // waiting for a scheduler to follow it.
    if (!u || !isReadableSheetLink(u)) return null;
    url = u;
  }

  let typeOverrides: Record<string, SheetType> | undefined;
  const to = r.typeOverrides;
  if (to && typeof to === "object") {
    const out: Record<string, SheetType> = {};
    for (const [k, v] of Object.entries(to as Record<string, unknown>)) {
      if (typeof k === "string" && k.length <= 40 && SHEET_TYPES.includes(v as SheetType)) {
        out[k] = v as SheetType;
      }
    }
    if (Object.keys(out).length) typeOverrides = out;
  }

  return { title, kind, csv, ...(url ? { url } : {}), ...(typeOverrides ? { typeOverrides } : {}) };
}

/** The stored source as the reader's plan, corrections applied. */
export function sourceToPlan(src: StoredSheetSource): SheetPlan | null {
  const plan = readSheet(src.title, src.csv);
  if (plan.empty) return null;
  const overrides = src.typeOverrides;
  if (!overrides) return plan;
  return { ...plan, columns: plan.columns.map((c) => ({ ...c, type: overrides[c.id] ?? c.type })) };
}

/**
 * The stored source as a Board — the shape every other part of the engine
 * already speaks. From here a saved sheet dashboard, the weekly digest and an
 * alert are all just the existing code reading a Board.
 */
export function sourceToBoard(src: StoredSheetSource): Board | null {
  const plan = sourceToPlan(src);
  return plan ? planToBoard(plan) : null;
}
