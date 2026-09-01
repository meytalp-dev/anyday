import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireMonday } from "@/lib/monday-server";
import { fetchBoards, fetchBoardMeta, parseBoardIds, coverage } from "@/lib/board-fetch";
import * as BI from "@/lib/board-intelligence";
import { profileBoard, applyPreferences, selectLiveWidgets, widgetKey } from "@/lib/board-profile";
import { readBoardPrefs } from "@/lib/board-prefs";

/**
 * Smart dashboard data for one or more boards. Generic (works by column TYPE),
 * so it produces a rich, real dashboard for ANY nonprofit's board:
 *  - headline KPIs (total, at-risk, stale, completed-share)
 *  - every status column as a breakdown chart
 *  - owner distribution, number summaries, attention list
 * Accepts ?boards=id,id to override the saved selection (right-rail picker).
 * Items are read with pagination, and the response says how much of the board
 * the numbers actually cover.
 *
 * Two extra fields, both language-independent:
 *  - `tones`: every status value on the board -> "risk" | "progress" | "done" |
 *    "neutral", derived from the HUE of the colour the board itself gave that
 *    label. The browser paints by this and therefore knows no words.
 *  - each breakdown row already carries its own `tone` (see board-intelligence).
 *
 * `?meta=1` is a cheap columns-only mode (no items at all): it returns just
 * `tones` + `entities`, for screens that need to colour a chip or name a row
 * without pulling the whole board again.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMonday();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const override = req.nextUrl.searchParams.get("boards");
  const saved = (await cookies()).get("anyday_selected_boards")?.value;
  const ids = parseBoardIds(override || saved);
  if (!ids.length) return NextResponse.json({ error: "בחרו בורד" }, { status: 400 });

  // Columns-only mode: the tone map + the board's own word for a row. No items.
  if (req.nextUrl.searchParams.get("meta") === "1") {
    try {
      const metaBoards = await fetchBoardMeta(ids, guard.token);
      const tones: Record<string, string> = {};
      const entities: Record<string, string> = {};
      for (const b of metaBoards) {
        Object.assign(tones, BI.statusTones(b));
        entities[b.name] = BI.terminology(b).entityPlural;
      }
      return NextResponse.json({ tones, entities, boardNames: metaBoards.map((b) => b.name) });
    } catch (e: unknown) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאה" }, { status: 502 });
    }
  }

  try {
    const biBoards = await fetchBoards(ids, guard.token);

    // KPIs are DERIVED per board — no hardcoded "active/completed" that only
    // fit graduates. For one board we use its own headline KPIs; for two we
    // show a compact per-board summary.
    const kpis = biBoards.length === 1
      ? BI.headlineKpis(biBoards[0])
      : biBoards.flatMap((b) => {
          const term = BI.terminology(b);
          const att = (BI.attention(b).data as { count: number }).count;
          return [
            { icon: "◆", n: b.items.length, label: `${term.entityPlural} · ${b.name}`, tone: "brand" },
            ...(att ? [{ icon: "▲", n: att, label: `טעונים בדיקה · ${b.name}`, tone: "rose" }] : []),
          ];
        }).slice(0, 4);

    let atRisk = 0;
    type LiveChart = BI.Widget & { drill?: Record<string, string[]>; key: string; boardId: string; pinned: boolean };
    const charts: LiveChart[] = [];
    /** Everything that did NOT earn a place — hidden, no-signal, overflow — so one click brings it back. */
    const moreOut: { key: string; boardId: string; label: string; hiddenByUser: boolean }[] = [];
    const attentionItems: { name: string; why: string; board: string }[] = [];

    for (const b of biBoards) {
      // The board no longer dumps EVERY column: the profile ranks them, the
      // user's ⭐/✕ (board_preferences) override, and the relevance layer
      // drops what tells no story (משוב מיטל 1.9 — לוח עמוס). Dropped widgets
      // ride along in `more`, one click from returning.
      const prefs = await readBoardPrefs(guard.orgId, b.id);
      const profile = applyPreferences(profileBoard(b), prefs);
      const { show, more } = selectLiveWidgets(profile, prefs);
      const suffix = biBoards.length > 1 ? ` · ${b.name}` : "";

      for (const lw of show) {
        // attention is rendered by the banner below, not as a chart card
        if (lw.kind === "attention") continue;
        let w: BI.Widget | null = null;
        let drill: Record<string, string[]> | undefined;
        if (lw.kind === "breakdown" && lw.col) {
          w = BI.breakdown(b, lw.col);
          const c = b.columns.find((x) => x.title === lw.col);
          if (w && c) {
            drill = {};
            for (const it of b.items) {
              const v = it.values.find((x) => x.colId === c.id)?.text || "— ריק —";
              (drill[v] ||= []).push(it.name);
            }
          }
        } else if (lw.kind === "byOwner" && lw.col) w = BI.byOwner(b, lw.col);
        else if (lw.kind === "numberSummary" && lw.col) w = BI.numberSummary(b, lw.col);
        else if (lw.kind === "list") w = BI.list(b);
        if (w) charts.push({ ...w, title: `${w.title}${suffix}`, drill, key: widgetKey(lw), boardId: b.id, pinned: lw.pinned });
      }

      const hiddenSet = new Set(prefs.hiddenWidgets ?? []);
      for (const lw of more) {
        if (lw.kind === "attention") continue;
        moreOut.push({ key: widgetKey(lw), boardId: b.id, label: `${lw.label}${suffix}`, hiddenByUser: hiddenSet.has(widgetKey(lw)) });
      }

      const items = (BI.attention(b).data as { items: { name: string; why: string }[] }).items;
      items.forEach((it) => attentionItems.push({ ...it, board: b.name }));
      atRisk += items.length;
    }

    // label -> semantic tone, so the browser never has to recognise a word
    const tones: Record<string, string> = {};
    for (const b of biBoards) Object.assign(tones, BI.statusTones(b));

    return NextResponse.json({
      boardNames: biBoards.map((b) => b.name),
      tones,
      kpis,
      charts: charts.slice(0, 8),
      more: moreOut,
      attention: { count: atRisk, items: attentionItems.slice(0, 8) },
      coverage: coverage(biBoards),
      source: biBoards.map((b) => b.name).join(" · "),
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאה" }, { status: 502 });
  }
}
