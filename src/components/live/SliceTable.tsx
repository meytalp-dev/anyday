"use client";

/**
 * רינדור חיתוך. שתי צורות מאותם נתונים:
 *
 * חד-ממדי (בלי ציר שני) → פסים, כמו כל פילוח אחר במסך.
 * דו-ממדי → טבלה שבה עוצמת התא נצבעת לפי גודלו היחסי, כדי שהעין תמצא את
 * הריכוזים לפני שהיא קוראת מספר אחד.
 *
 * הצבע של כותרת עמודה מגיע מהטון שהשרת חישב מצבע התווית בלוח עצמו — המסך
 * לא מזהה אף מילה, ולכן לוח בעברית, בערבית או באנגלית נצבע זהה.
 */

import type { CSSProperties } from "react";
import { C, toneStyle } from "./theme";

interface AxisKey { key: string; tone?: string }

export interface SliceData {
  rowKeys: AxisKey[];
  colKeys: AxisKey[];
  cells: number[][];
  rowTotals: number[];
  colTotals: number[];
  grandTotal: number;
  measureLabel: string;
  matched: number;
  ofTotal: number;
  skipped: string[];
}

const num = (n: number) => n.toLocaleString("he-IL");

const cellBase: CSSProperties = {
  padding: "6px 9px", fontSize: 12, textAlign: "center",
  fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
};

const headBase: CSSProperties = {
  ...cellBase, fontWeight: 800, fontSize: 11, position: "sticky", top: 0, background: "#fff",
};

export function SliceBody({ d }: { d: SliceData }) {
  const twoD = d.colKeys.length > 0;

  const footer = (
    <>
      {d.matched < d.ofTotal && (
        <div style={{ marginTop: 9, fontSize: 11, color: C.muted }}>
          מוצג על {num(d.matched)} רשומות מתוך {num(d.ofTotal)} — לפי המסננים שהוגדרו.
        </div>
      )}
      {d.skipped.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: C.muted }}>
          בלוחות הבאים לא נמצאה העמודה: {d.skipped.join(" · ")}
        </div>
      )}
    </>
  );

  if (!d.rowKeys.length) {
    return <div style={{ fontSize: 12, color: C.muted }}>אין רשומות שעונות על החיתוך הזה.{footer}</div>;
  }

  /* ── one dimension: the familiar bars ── */
  if (!twoD) {
    const max = Math.max(...d.rowTotals, 1);
    return (
      <div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {d.rowKeys.map((k, i) => {
            const sc = toneStyle(k.tone);
            return (
              <div key={k.key} style={{ display: "grid", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5 }}>
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 190 }}>{k.key}</span>
                  <b style={{ fontVariantNumeric: "tabular-nums", color: sc.fg }}>{num(d.rowTotals[i])}</b>
                </div>
                <div style={{ height: 9, borderRadius: 999, background: "#F2F1F9", overflow: "hidden" }}>
                  <div style={{ width: `${(d.rowTotals[i] / max) * 100}%`, height: "100%", background: sc.fg, borderRadius: 999, transition: "width .6s cubic-bezier(.2,.8,.2,1)" }} />
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: C.muted }}>{d.measureLabel}</div>
        {footer}
      </div>
    );
  }

  /* ── two dimensions: a table, shaded by relative weight ── */
  const peak = Math.max(...d.cells.flat(), 1);

  return (
    <div>
      {/* Wide tables scroll inside their own box; the page never scrolls sideways. */}
      <div style={{ overflowX: "auto", margin: "0 -4px", padding: "0 4px" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: Math.min(120 + d.colKeys.length * 78, 720) }}>
          <thead>
            <tr>
              <th style={{ ...headBase, textAlign: "right", color: C.muted, insetInlineStart: 0, zIndex: 1 }} />
              {d.colKeys.map((k) => {
                const sc = toneStyle(k.tone);
                return (
                  <th key={k.key} style={{ ...headBase, color: sc.fg }} title={k.key}>
                    <span style={{ display: "inline-block", maxWidth: 92, overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "bottom" }}>{k.key}</span>
                  </th>
                );
              })}
              <th style={{ ...headBase, color: C.muted, borderInlineStart: "1px solid #EEEDF5" }}>סה״כ</th>
            </tr>
          </thead>
          <tbody>
            {d.rowKeys.map((rk, ri) => (
              <tr key={rk.key} style={{ borderTop: "1px solid #F4F3FB" }}>
                <th
                  scope="row"
                  title={rk.key}
                  style={{ ...cellBase, textAlign: "right", fontWeight: 700, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}
                >{rk.key}</th>
                {d.colKeys.map((_, ci) => {
                  const v = d.cells[ri][ci];
                  // Weight, not category: the same purple at varying strength
                  // keeps the eye on WHERE the mass is, not on six competing hues.
                  const a = v <= 0 ? 0 : 0.08 + (v / peak) * 0.55;
                  return (
                    <td key={ci} style={{ ...cellBase, background: v > 0 ? `rgba(108,76,241,${a.toFixed(3)})` : "transparent", color: a > 0.42 ? "#fff" : C.ink, fontWeight: v > 0 ? 700 : 400 }}>
                      {v > 0 ? num(v) : <span style={{ color: "#C9C7D8" }}>·</span>}
                    </td>
                  );
                })}
                <td style={{ ...cellBase, fontWeight: 800, color: C.muted, borderInlineStart: "1px solid #EEEDF5" }}>{num(d.rowTotals[ri])}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "1.5px solid #EEEDF5" }}>
              <th scope="row" style={{ ...cellBase, textAlign: "right", fontWeight: 800, color: C.muted }}>סה״כ</th>
              {d.colTotals.map((t, i) => (
                <td key={i} style={{ ...cellBase, fontWeight: 800, color: C.muted }}>{num(t)}</td>
              ))}
              <td style={{ ...cellBase, fontWeight: 800, color: C.grape }}>{num(d.grandTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: C.muted }}>המספרים בטבלה: {d.measureLabel}</div>
      {footer}
    </div>
  );
}
