// Turn a SAVED dashboard spec into live widget data.
//
// Zero new analysis: every widget is one call into the engine. This module
// only decides WHICH calls to make and in what order — the order the user
// approved in the wizard. A widget whose column has since been deleted on
// Monday is skipped silently: a saved dashboard must keep rendering what it
// still can, not crash over what it cannot.
//
// It takes the BOARDS, plural, because a slice may cross them. A single-board
// dashboard simply passes one.

import * as BI from "./board-intelligence";
import type { Board, Widget } from "./board-intelligence";
import { crossBreakdown } from "./cross-board";
import { sliceWidget } from "./slice";
import type { DashboardSpec } from "./dashboard-spec";

/**
 * A saved dashboard's widgets, plus the ones this board could not produce.
 *
 * Every widget that failed to compute used to be dropped on the floor. A spec
 * naming a column the board does not have — which is what an AI proposal does
 * when it guesses a name — therefore produced a dashboard with zero widgets,
 * saved successfully, and rendered as a title above empty space. The user is
 * told "created" and shown nothing, with no way to learn why.
 *
 * So the failures come back too. Nothing is hidden; the screen decides how to
 * say it.
 */
export function computeSpecWidgets(
  boards: Board[], spec: DashboardSpec
): { widgets: Widget[]; unbuilt: DashboardSpec["widgets"] } {
  const board = boards[0];
  if (!board) return { widgets: [], unbuilt: spec.widgets };

  const unbuilt: DashboardSpec["widgets"] = [];
  const out: Widget[] = [];
  for (const w of spec.widgets) {
    let computed: Widget | null = null;
    switch (w.kind) {
      case "breakdown":     computed = w.col ? BI.breakdown(board, w.col) : null; break;
      case "byOwner":       computed = w.col ? BI.byOwner(board, w.col) : null; break;
      case "numberSummary": computed = w.col ? BI.numberSummary(board, w.col) : null; break;
      case "attention":     computed = BI.attention(board); break;
      case "list":          computed = BI.list(board); break;
      case "slice":         computed = w.slice ? sliceWidget(boards, w.slice) : null; break;
      default:
        // Dashboards saved before the slice engine carry the old cross-board
        // widget. They keep rendering exactly as they did; only new ones stop
        // being created in that shape.
        if ((w.kind as string) === "crossBreakdown") computed = w.col ? crossBreakdown(boards, w.col) : null;
        break;
    }
    if (computed) out.push(computed);
    else unbuilt.push(w);
  }
  return { widgets: out, unbuilt };
}
