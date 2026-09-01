// Server-side access to board_preferences ("מה חשוב לך", W2-1) — shared by
// /api/board-prefs (read/write) and /api/board-profile (read-and-apply).
// Lives in lib because a route file may export nothing but HTTP verbs.

import { createServiceClient } from "./supabase-server";
import type { BoardPrefs } from "./board-profile";

export const MAX_MARKED_COLUMNS = 30;
export const MAX_GOALS_CHARS = 500;

/**
 * Only the fields the product understands survive, each bounded. The document
 * is stored as JSONB and echoed back to browsers and AI prompts — a free-form
 * blob would be a place to smuggle anything.
 */
export function sanitizePrefs(raw: unknown): BoardPrefs {
  const p = (raw ?? {}) as Record<string, unknown>;
  const out: BoardPrefs = {};
  if (Array.isArray(p.importantColumns)) {
    out.importantColumns = p.importantColumns
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.slice(0, 100))
      .slice(0, MAX_MARKED_COLUMNS);
  }
  // Widget keys from the live board's ⭐/✕ — same bounds as column marks.
  const keyList = (v: unknown): string[] | undefined =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string").map((s) => s.slice(0, 120)).slice(0, MAX_MARKED_COLUMNS)
      : undefined;
  const pinned = keyList(p.pinnedWidgets);
  if (pinned) out.pinnedWidgets = pinned;
  const hiddenW = keyList(p.hiddenWidgets);
  if (hiddenW) out.hiddenWidgets = hiddenW;
  if (typeof p.goalsText === "string") out.goalsText = p.goalsText.slice(0, MAX_GOALS_CHARS);
  if (p.toneOverrides && typeof p.toneOverrides === "object" && !Array.isArray(p.toneOverrides)) {
    const t: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.toneOverrides as Record<string, unknown>).slice(0, 50)) {
      if (typeof v === "string" && ["risk", "progress", "done", "neutral"].includes(v)) t[k.slice(0, 100)] = v;
    }
    out.toneOverrides = t;
  }
  if (Array.isArray(p.mutedInsights)) {
    out.mutedInsights = p.mutedInsights
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.slice(0, 200))
      .slice(0, 50);
  }
  return out;
}

/** One org's saved prefs for one source, or {} — never an error the UI must handle. */
export async function readBoardPrefs(orgId: string, sourceRef: string): Promise<BoardPrefs> {
  if (!orgId || orgId === "personal") return {};
  const service = createServiceClient();
  if (!service) return {};
  const { data, error } = await service
    .from("board_preferences")
    .select("prefs")
    .eq("org_id", orgId)
    .eq("source_ref", sourceRef)
    .maybeSingle();
  if (error || !data) return {};
  return sanitizePrefs(data.prefs);
}
