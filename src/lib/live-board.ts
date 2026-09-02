// "The calm board" — the whole live-dashboard computation, as one pure function.
//
// This logic used to live inside /api/dashboard, which meant it was available
// only to someone with a Monday account. Meytal asked for everything the
// connected dashboards have to exist for an uploaded spreadsheet too, so it
// moves here: given boards and the user's preferences, it returns exactly what
// the screen renders. The route now reads preferences from the database and
// calls this; the sheet screen holds preferences in the tab and calls the same
// function. One truth, not two implementations that drift.
//
// Nothing here decides what is interesting by name. The profile ranks columns
// by type and fill, the relevance layer drops what tells no story, and the
// user's own ⭐/✕ and purpose sentence override both.

import * as BI from "./board-intelligence";
import type { Board, Widget } from "./board-intelligence";
import {
  profileBoard, applyPreferences, selectLiveWidgets, widgetKey,
  type BoardPrefs,
} from "./board-profile";

export interface LiveChart extends Widget {
  /** Segment label -> the names behind it, so a breakdown opens into a list. */
  drill?: Record<string, string[]>;
  key: string;
  boardId: string;
  pinned: boolean;
}

export interface MoreWidget {
  key: string;
  boardId: string;
  label: string;
  /** True when the user hid it, false when the relevance layer dropped it. */
  hiddenByUser: boolean;
}

export interface LiveBoardData {
  boardNames: string[];
  tones: Record<string, string>;
  kpis: { icon: string; n: number; label: string; tone: string }[];
  charts: LiveChart[];
  /** Everything that did not earn a place — one click from returning. */
  more: MoreWidget[];
  attention: { count: number; items: { name: string; why: string; board: string }[] };
  source: string;
}

export interface LiveBoardInput {
  board: Board;
  prefs: BoardPrefs;
}

const MAX_CHARTS = 8;
const MAX_ATTENTION = 8;

/** KPIs are DERIVED per board — never a hardcoded "active/completed" that only
 *  fits graduates. One board shows its own headline; several show a compact
 *  per-board summary instead, or the tiles stop meaning anything. */
function kpisFor(boards: Board[]) {
  if (boards.length === 1) return BI.headlineKpis(boards[0]);
  return boards.flatMap((b) => {
    const term = BI.terminology(b);
    const att = (BI.attention(b).data as { count: number }).count;
    return [
      { icon: "◆", n: b.items.length, label: `${term.entityPlural} · ${b.name}`, tone: "brand" },
      ...(att ? [{ icon: "▲", n: att, label: `טעונים בדיקה · ${b.name}`, tone: "rose" }] : []),
    ];
  }).slice(0, 4);
}

/** The names behind each segment of a breakdown. Computed here rather than in
 *  the browser, because it is the same walk over the items either way. */
function drillFor(board: Board, colTitle: string): Record<string, string[]> | undefined {
  const c = board.columns.find((x) => x.title === colTitle);
  if (!c) return undefined;
  const out: Record<string, string[]> = {};
  for (const it of board.items) {
    const v = it.values.find((x) => x.colId === c.id)?.text || "— ריק —";
    (out[v] ||= []).push(it.name);
  }
  return out;
}

export function buildLiveBoard(inputs: LiveBoardInput[]): LiveBoardData {
  const boards = inputs.map((i) => i.board);
  const charts: LiveChart[] = [];
  const more: MoreWidget[] = [];
  const attentionItems: { name: string; why: string; board: string }[] = [];
  let atRisk = 0;

  for (const { board, prefs } of inputs) {
    // The board does not dump every column: the profile ranks them, the user's
    // ⭐/✕ override, and the relevance layer drops what tells no story
    // (משוב מיטל 1.9 — "לוח עמוס"). What is dropped rides along in `more`.
    const profile = applyPreferences(profileBoard(board), prefs);
    const { show, more: dropped } = selectLiveWidgets(profile, prefs);
    const suffix = boards.length > 1 ? ` · ${board.name}` : "";

    for (const lw of show) {
      // attention is rendered by its own banner, never as a chart card
      if (lw.kind === "attention") continue;
      let w: Widget | null = null;
      let drill: Record<string, string[]> | undefined;
      if (lw.kind === "breakdown" && lw.col) {
        w = BI.breakdown(board, lw.col);
        if (w) drill = drillFor(board, lw.col);
      } else if (lw.kind === "byOwner" && lw.col) w = BI.byOwner(board, lw.col);
      else if (lw.kind === "numberSummary" && lw.col) w = BI.numberSummary(board, lw.col);
      else if (lw.kind === "list") w = BI.list(board);
      if (w) charts.push({ ...w, title: `${w.title}${suffix}`, drill, key: widgetKey(lw), boardId: board.id, pinned: lw.pinned });
    }

    const hiddenSet = new Set(prefs.hiddenWidgets ?? []);
    for (const lw of dropped) {
      if (lw.kind === "attention") continue;
      more.push({ key: widgetKey(lw), boardId: board.id, label: `${lw.label}${suffix}`, hiddenByUser: hiddenSet.has(widgetKey(lw)) });
    }

    const items = (BI.attention(board).data as { items: { name: string; why: string }[] }).items;
    items.forEach((it) => attentionItems.push({ ...it, board: board.name }));
    atRisk += items.length;
  }

  // label -> semantic tone, so the browser never has to recognise a word
  const tones: Record<string, string> = {};
  for (const b of boards) Object.assign(tones, BI.statusTones(b));

  return {
    boardNames: boards.map((b) => b.name),
    tones,
    kpis: kpisFor(boards),
    charts: charts.slice(0, MAX_CHARTS),
    more,
    attention: { count: atRisk, items: attentionItems.slice(0, MAX_ATTENTION) },
    source: boards.map((b) => b.name).join(" · "),
  };
}
