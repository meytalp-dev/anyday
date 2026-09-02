"use client";

/**
 * בונה החיתוכים (בקשת מיטל 2.9: "חיתוכים שונים של כל מיני פרמטרים... הכל
 * צריך להיות פתוח").
 *
 * ארבע בחירות, כולן מהעמודות האמיתיות של הלוח הנבחר: קבץ לפי · חתוך עם ·
 * מדוד · רק כאשר. אין כאן שום ידע על ארגון מסוים — הרשימות מגיעות מהשרת,
 * מאותה רשימה בדיוק ש-AI מקבל, ולכן המסך לא יכול להציע משהו שהשמירה תדחה.
 *
 * המסננים מוצעים לפי טיפוס העמודה: על מספר מציעים "גדול מ", על טקסט "מכיל",
 * ועל עמודת תווית מציעים "שווה ל" — לא כי מישהו קרא את השם, אלא כי זה
 * הטיפוס.
 */

import { useMemo, useState } from "react";
import type { Agg, FilterOp, SliceFilter, SliceSpec } from "@/lib/slice";
import { C } from "./theme";

export interface SliceCol {
  title: string;
  /** The semantic bucket, from the server's profile. */
  type: "status" | "date" | "people" | "number" | "text" | "meta";
}

const AGG_LABEL: Record<Agg, string> = {
  count: "מספר רשומות", sum: "סכום", avg: "ממוצע", min: "מינימום", max: "מקסימום",
};

const OP_LABEL: Record<FilterOp, string> = {
  is: "שווה ל", isNot: "שונה מ", contains: "מכיל",
  gt: "גדול מ", lt: "קטן מ", between: "בין",
  isEmpty: "ריק", notEmpty: "לא ריק",
};

/** Which comparisons make sense on a column — decided by its type, never its name. */
function opsFor(type: SliceCol["type"]): FilterOp[] {
  if (type === "number" || type === "date") return ["is", "gt", "lt", "between", "isEmpty", "notEmpty"];
  if (type === "text") return ["contains", "is", "isNot", "isEmpty", "notEmpty"];
  return ["is", "isNot", "isEmpty", "notEmpty"];
}

const NEEDS_VALUE = (op: FilterOp) => op !== "isEmpty" && op !== "notEmpty";

const label: React.CSSProperties = { fontSize: 11.5, fontWeight: 800, color: C.ink, marginBottom: 5 };
const field: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 10, border: "1.5px solid #ECEBF5",
  background: "#FAF9FE", fontSize: 12.5, fontFamily: "inherit", color: C.ink,
};

export function SliceBuilder({ cols, onAdd }: { cols: SliceCol[]; onAdd: (s: SliceSpec) => void }) {
  const usable = useMemo(() => cols.filter((c) => c.type !== "meta"), [cols]);
  const numberCols = useMemo(() => usable.filter((c) => c.type === "number"), [usable]);

  const [rowCol, setRowCol] = useState(usable[0]?.title ?? "");
  const [colCol, setColCol] = useState("");
  /** "" = count; otherwise "agg|column". */
  const [measure, setMeasure] = useState("");
  const [filters, setFilters] = useState<SliceFilter[]>([]);

  if (!usable.length) {
    return <div style={{ fontSize: 12, color: C.muted }}>בלוח הזה אין עמודות שאפשר לחתוך לפיהן.</div>;
  }

  const measureOptions: { value: string; label: string }[] = [
    { value: "", label: AGG_LABEL.count },
    ...numberCols.flatMap((c) =>
      (["sum", "avg", "min", "max"] as Agg[]).map((a) => ({ value: `${a}|${c.title}`, label: `${AGG_LABEL[a]} "${c.title}"` }))
    ),
  ];

  function buildSpec(): SliceSpec {
    const spec: SliceSpec = { rowCol };
    if (colCol && colCol !== rowCol) spec.colCol = colCol;
    if (measure) {
      const [agg, col] = measure.split("|");
      spec.measure = { col, agg: agg as Agg };
    }
    const clean = filters.filter((f) => f.col && (!NEEDS_VALUE(f.op) ? true : (f.value ?? "").trim()));
    if (clean.length) spec.filters = clean;
    return spec;
  }

  function setFilter(i: number, patch: Partial<SliceFilter>) {
    setFilters(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  }

  const preview = describe(buildSpec());

  return (
    <div style={{ border: "1.5px solid #ECEBF5", borderRadius: 14, padding: 14, background: "#FFF" }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 3 }}>בניית חיתוך</div>
      <p style={{ fontSize: 11.5, color: C.muted, margin: "0 0 12px", lineHeight: 1.6 }}>
        כל צירוף של העמודות שקיימות בלוח. מה שנבנה כאן נשמר בדשבורד ומתעדכן לבד.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <div style={label}>קבץ לפי</div>
          <select value={rowCol} onChange={(e) => setRowCol(e.target.value)} style={field}>
            {usable.map((c) => <option key={c.title} value={c.title}>{c.title}</option>)}
          </select>
        </div>
        <div>
          <div style={label}>חתוך עם <span style={{ fontWeight: 500, color: C.muted }}>(לא חובה)</span></div>
          <select value={colCol} onChange={(e) => setColCol(e.target.value)} style={field}>
            <option value="">— ללא —</option>
            {usable.filter((c) => c.title !== rowCol).map((c) => <option key={c.title} value={c.title}>{c.title}</option>)}
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={label}>מה מודדים</div>
        <select value={measure} onChange={(e) => setMeasure(e.target.value)} style={field}>
          {measureOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div style={label}>רק כאשר <span style={{ fontWeight: 500, color: C.muted }}>(לא חובה)</span></div>
      {filters.map((f, i) => {
        const colType = usable.find((c) => c.title === f.col)?.type ?? "text";
        const ops = opsFor(colType);
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px 1fr 28px", gap: 6, marginBottom: 6, alignItems: "center" }}>
            <select value={f.col} onChange={(e) => {
              const t = usable.find((c) => c.title === e.target.value)?.type ?? "text";
              const allowed = opsFor(t);
              setFilter(i, { col: e.target.value, op: allowed.includes(f.op) ? f.op : allowed[0] });
            }} style={field}>
              {usable.map((c) => <option key={c.title} value={c.title}>{c.title}</option>)}
            </select>
            <select value={f.op} onChange={(e) => setFilter(i, { op: e.target.value as FilterOp })} style={field}>
              {ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
            </select>
            {NEEDS_VALUE(f.op) ? (
              <input
                value={f.value ?? ""}
                onChange={(e) => setFilter(i, { value: e.target.value })}
                placeholder={f.op === "between" ? "מ־" : "ערך"}
                style={field}
              />
            ) : <span />}
            <button
              onClick={() => setFilters(filters.filter((_, j) => j !== i))}
              aria-label="הסרת המסנן"
              style={{ border: "none", background: "#F4F3FB", borderRadius: 8, width: 28, height: 28, cursor: "pointer", color: C.muted, fontSize: 13 }}
            >✕</button>
            {f.op === "between" && (
              <input
                value={f.value2 ?? ""}
                onChange={(e) => setFilter(i, { value2: e.target.value })}
                placeholder="עד"
                style={{ ...field, gridColumn: "3 / 4" }}
              />
            )}
          </div>
        );
      })}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        {filters.length < 5 && (
          <button
            onClick={() => setFilters([...filters, { col: usable[0].title, op: opsFor(usable[0].type)[0], value: "" }])}
            style={{ border: `1.5px dashed #DAD7EC`, background: "#FFF", borderRadius: 10, padding: "7px 12px", fontSize: 12, fontFamily: "inherit", color: C.muted, cursor: "pointer" }}
          >+ מסנן</button>
        )}
        <span style={{ flex: 1 }} />
        <button
          onClick={() => onAdd(buildSpec())}
          style={{ border: "none", background: C.grape, color: "#fff", borderRadius: 11, padding: "9px 16px", fontSize: 12.5, fontWeight: 800, fontFamily: "inherit", cursor: "pointer" }}
        >הוספת החיתוך</button>
      </div>

      <div style={{ marginTop: 10, fontSize: 11.5, color: C.grape, background: C.grapeL, borderRadius: 9, padding: "7px 10px", lineHeight: 1.6 }}>
        {preview}
      </div>
    </div>
  );
}

/** One sentence describing the slice, so nothing is added blind. */
export function describe(s: SliceSpec): string {
  const head = s.measure && s.measure.agg !== "count"
    ? `${AGG_LABEL[s.measure.agg]} "${s.measure.col}"`
    : "מספר הרשומות";
  const by = ` לפי "${s.rowCol}"`;
  const cross = s.colCol ? `, חתוך עם "${s.colCol}"` : "";
  const where = s.filters?.length
    ? ` — רק כאשר ${s.filters.map((f) => `"${f.col}" ${OP_LABEL[f.op]}${NEEDS_VALUE(f.op) ? ` ${f.value ?? ""}` : ""}`).join(" וגם ")}`
    : "";
  return head + by + cross + where;
}
