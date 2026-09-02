"use client";

/**
 * כרטיסי הלוח החי — מדד-כותרת, כרטיס-רכיב, גוף-התרשים ופתיחת-פילוח לשמות.
 *
 * הועברו לכאן מ-`/app` (בקשת מיטל 2.9: "כל מה שקיים בדשבורדים שמחוברים
 * למונדיי, יהיה גם כשמעלים גיליון"). לפני כן מסך הגיליון החזיק גרסה משלו,
 * דלה יותר — שני מימושים שהתחילו להתפצל. עכשיו יש אחד, והגיליון מקבל בדיוק
 * את מה שלוח מחובר מקבל: ⭐/✕, פתיחת פילוח, וכל סוגי הרכיבים.
 *
 * הכרטיסים לא יודעים מאיפה הנתונים באו. הם מקבלים `Widget` ומציירים.
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Widget } from "@/lib/board-intelligence";
import { C, pick, toneStyle } from "./theme";
import { SliceBody, type SliceData } from "./SliceTable";

export interface Kpi { icon: string; n: number; label: string; tone: string }

/* A number that counts up on first paint, unless the viewer asked for less
   motion. Pure decoration — it must never delay or block the real value. */
function useCountUp(target: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") { setN(target); return; }
    if (window.matchMedia("(prefers-reduced-motion:reduce)").matches) { setN(target); return; }
    let raf = 0;
    const t0 = performance.now(), dur = 900;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setN(Math.round((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return n;
}

export function KpiTile({ k, i }: { k: Kpi; i: number }) {
  const c = k.tone === "rose" ? { fg: C.coral, bg: C.coralL }
    : k.tone === "mint" ? { fg: C.teal, bg: C.tealL }
    : k.tone === "brand" ? { fg: C.grape, bg: C.grapeL } : pick(i + 3);
  const n = useCountUp(k.n);
  return (
    <div style={{ background: C.panel, border: "1px solid #ECEBF5", borderRadius: 18, padding: "16px 18px", boxShadow: "0 4px 16px -8px rgba(60,50,120,.14)", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: -14, insetInlineStart: -14, width: 60, height: 60, borderRadius: "50%", background: c.bg, opacity: .6 }} />
      <div style={{ position: "relative" }}>
        <div style={{ width: 40, height: 40, borderRadius: 13, background: c.bg, color: c.fg, display: "grid", placeItems: "center", fontSize: 20, marginBottom: 10 }}>{k.icon}</div>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.02em", fontVariantNumeric: "tabular-nums", color: c.fg }}>{n.toLocaleString("he-IL")}</div>
        <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 600 }}>{k.label}</div>
      </div>
    </div>
  );
}

export function ChartCard({ w, i, pinned, onPin, onHide, onRemove }: {
  w: Widget; i: number;
  /** Live-board curation (משוב מיטל 1.9): ⭐ pins the card first, ✕ hides it.
      Saved dashboards pass none of these and render exactly as before. */
  pinned?: boolean; onPin?: () => void; onHide?: () => void;
  /** A slice the user built by hand is removed outright, not hidden. */
  onRemove?: () => void;
}) {
  const c = pick(i);
  const act: CSSProperties = { border: "none", background: "none", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "3px 5px", borderRadius: 7, color: "#B4B2C6" };
  return (
    <div style={{ background: C.panel, border: `1px solid ${pinned ? C.grape + "55" : "#ECEBF5"}`, borderRadius: 18, padding: "16px 18px", boxShadow: "0 4px 16px -8px rgba(60,50,120,.12)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ width: 8, height: 22, borderRadius: 4, background: c.fg }} />
        <div style={{ fontSize: 14, fontWeight: 800, flex: 1 }}>{w.title}</div>
        {onPin && (
          <button onClick={onPin} title={pinned ? "ביטול ההצמדה" : "חשוב לי — הצמדה לראש הלוח"} aria-label={pinned ? `ביטול הצמדה של ${w.title}` : `הצמדת ${w.title} לראש הלוח`} aria-pressed={pinned} style={{ ...act, color: pinned ? C.amber : "#B4B2C6" }}>
            {pinned ? "★" : "☆"}
          </button>
        )}
        {onHide && (
          <button onClick={onHide} title="פחות רלוונטי — הסתרה מהלוח (אפשר להחזיר למטה)" aria-label={`הסתרת ${w.title} מהלוח`} style={act}>✕</button>
        )}
        {onRemove && (
          <button onClick={onRemove} title="הסרת החיתוך" aria-label={`הסרת ${w.title}`} style={act}>✕</button>
        )}
      </div>
      <ChartBody w={w} c={c} />
      <div style={{ marginTop: 12, fontSize: 10.5, color: "#B4B2C6", borderTop: "1px dashed #EEEDF5", paddingTop: 8 }}>🔎 {w.source}</div>
    </div>
  );
}

export function ChartBody({ w, c }: { w: Widget; c: { fg: string; bg: string } }) {
  const d = w.data as Record<string, unknown>;
  const drill = (w as Widget & { drill?: Record<string, string[]> }).drill;
  const [openRow, setOpenRow] = useState<string | null>(null);

  if (w.kind === "breakdown" || w.kind === "byOwner") {
    const rows = (d.rows as { label: string; n: number; tone?: string }[]) || [];
    const max = Math.max(...rows.map((r) => r.n), 1);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {rows.slice(0, 8).map((r, i) => {
          const sc = w.kind === "breakdown" ? toneStyle(r.tone) : pick(i);
          const canOpen = drill && drill[r.label]?.length;
          const isOpen = openRow === r.label;
          return (
            <div key={r.label} style={{ display: "grid", gap: 4 }}>
              <button onClick={() => canOpen && setOpenRow(isOpen ? null : r.label)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, background: "none", border: "none", padding: 0, cursor: canOpen ? "pointer" : "default", fontFamily: "inherit", color: C.ink, textAlign: "right" }}>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 190 }}>
                  {r.label}
                  {canOpen && <span style={{ color: C.grape, background: C.grapeL, marginInlineStart: 7, fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 999, whiteSpace: "nowrap" }}>{isOpen ? "▾ הסתר" : `הצג ${r.n} שמות`}</span>}
                </span>
                <b style={{ fontVariantNumeric: "tabular-nums", color: sc.fg }}>{r.n}</b>
              </button>
              <div style={{ height: 9, borderRadius: 999, background: "#F2F1F9", overflow: "hidden" }}>
                <div style={{ width: `${(r.n / max) * 100}%`, height: "100%", background: sc.fg, borderRadius: 999, transition: "width .6s cubic-bezier(.2,.8,.2,1)" }} />
              </div>
              {isOpen && canOpen && <DrillList names={drill![r.label]} accent={sc.fg} />}
            </div>
          );
        })}
      </div>
    );
  }

  if (w.kind === "crossBreakdown") {
    // One column, read from several boards (בקשת מיטל): a group per board —
    // its name, a stacked bar of its own label colours, and the counts.
    const groups = (d.groups as { boardName: string; colTitle: string; total: number; rows: { label: string; n: number; tone?: string }[] }[]) || [];
    const skipped = (d.skipped as string[]) || [];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {groups.map((g) => {
          const shown = g.rows.filter((r) => r.label !== "— ריק —").slice(0, 6);
          const denom = g.total || 1;
          return (
            <div key={g.boardName}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>{g.boardName}</span>
                <span style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap" }}>{g.total} רשומות</span>
              </div>
              <div style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", background: "#F2F1F9", marginBottom: 6 }}>
                {shown.map((r) => (
                  <div key={r.label} title={`${r.label}: ${r.n}`} style={{ width: `${(r.n / denom) * 100}%`, background: toneStyle(r.tone).fg }} />
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {shown.map((r) => {
                  const sc = toneStyle(r.tone);
                  return (
                    <span key={r.label} style={{ fontSize: 10.5, fontWeight: 700, color: sc.fg, background: sc.bg, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
                      {r.label} · {r.n}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
        {skipped.length > 0 && (
          <div style={{ fontSize: 11, color: C.muted }}>בלוחות הבאים לא נמצאה העמודה: {skipped.join(" · ")}</div>
        )}
      </div>
    );
  }

  if (w.kind === "slice") return <SliceBody d={d as unknown as SliceData} />;

  if (w.kind === "numberSummary")
    return (
      <div style={{ display: "flex", gap: 10 }}>
        {([["סה\"כ", d.sum], ["ממוצע", d.avg], ["מקס׳", d.max]] as [string, unknown][]).map(([l, v]) => (
          <div key={l} style={{ flex: 1, background: c.bg, borderRadius: 13, padding: "12px" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: c.fg, fontVariantNumeric: "tabular-nums" }}>{String(v)}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{l}</div>
          </div>
        ))}
      </div>
    );

  if (w.kind === "list") {
    const items = (d.items as string[]) || [];
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {items.slice(0, 10).map((n, i) => (
          <span key={i} style={{ fontSize: 12, padding: "5px 11px", background: pick(i).bg, color: pick(i).fg, borderRadius: 999, fontWeight: 600 }}>{n}</span>
        ))}
      </div>
    );
  }
  return null;
}

/* The names behind one segment. A sorted, scrollable column list — not a
   cloud of chips — so 49 names read like a list and 400 don't need a cap. */
export function DrillList({ names, accent }: { names: string[]; accent: string }) {
  const [q, setQ] = useState("");
  const sorted = useMemo(() => [...names].sort((a, b) => a.localeCompare(b, "he")), [names]);
  const shown = q.trim() ? sorted.filter((n) => n.toLowerCase().includes(q.trim().toLowerCase())) : sorted;
  return (
    <div style={{ background: "#F8F7FC", border: "1px solid #ECEBF5", borderRadius: 12, padding: "8px 10px", marginTop: 2, animation: "fade .2s both" }}>
      {names.length > 12 && (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש בשמות…" aria-label="חיפוש בשמות"
          style={{ width: "100%", boxSizing: "border-box", fontSize: 12.5, padding: "6px 10px", border: "1px solid #E4E2F0", borderRadius: 8, background: C.panel, color: C.ink, fontFamily: "inherit", marginBottom: 6, outline: "none" }} />
      )}
      <div style={{ maxHeight: 216, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", columnGap: 12, rowGap: 1 }}>
        {shown.map((name, j) => (
          <div key={j} title={name} style={{ fontSize: 12.5, lineHeight: "22px", padding: "1px 8px", borderInlineStart: `2px solid ${accent}`, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
        ))}
        {shown.length === 0 && <div style={{ fontSize: 12, color: C.muted, padding: "6px 8px" }}>אין שם שמתאים ל&quot;{q.trim()}&quot;</div>}
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6, paddingTop: 6, borderTop: "1px dashed #EEEDF5", display: "flex", justifyContent: "space-between" }}>
        <span>{q.trim() ? `${shown.length} מתוך ${names.length}` : `${names.length} שמות`}</span>
        {names.length > 8 && <span style={{ opacity: .7 }}>לפי א״ב</span>}
      </div>
      <style>{`@keyframes fade{from{opacity:0}}`}</style>
    </div>
  );
}
