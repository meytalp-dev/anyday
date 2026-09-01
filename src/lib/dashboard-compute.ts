// Turn a SAVED dashboard spec into live widget data.
//
// Zero new analysis: every widget is one call into board-intelligence (the one
// engine). This module only decides WHICH calls to make and in what order —
// the order the user approved in the wizard. A widget whose column has since
// been deleted on Monday is skipped silently: a saved dashboard must keep
// rendering what it still can, not crash over what it cannot.

import * as BI from "./board-intelligence";
import type { Board, Widget } from "./board-intelligence";
import type { DashboardSpec } from "./dashboard-spec";

export function computeSpecWidgets(board: Board, spec: DashboardSpec): Widget[] {
  const out: Widget[] = [];
  for (const w of spec.widgets) {
    let computed: Widget | null = null;
    switch (w.kind) {
      case "breakdown":     computed = w.col ? BI.breakdown(board, w.col) : null; break;
      case "byOwner":       computed = w.col ? BI.byOwner(board, w.col) : null; break;
      case "numberSummary": computed = w.col ? BI.numberSummary(board, w.col) : null; break;
      case "attention":     computed = BI.attention(board); break;
      case "list":          computed = BI.list(board); break;
    }
    if (computed) out.push(computed);
  }
  return out;
}
