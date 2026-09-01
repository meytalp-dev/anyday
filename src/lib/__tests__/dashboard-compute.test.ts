/**
 * חישוב דשבורד שמור: spec מאושר + לוח חי → רכיבים עם נתונים.
 * הכלל: אפס חישוב חדש — כל רכיב הוא קריאה למנוע האחד (board-intelligence);
 * הקובץ הנבדק רק בוחר אילו קריאות לבצע ובאיזה סדר, לפי ה-spec.
 */
import { describe, it, expect } from "vitest";
import { computeSpecWidgets } from "../dashboard-compute";
import type { Board, Col, Item } from "../board-intelligence";

const col = (id: string, title: string, type: string, settings?: object): Col => ({
  id, title, type, ...(settings ? { settings_str: JSON.stringify(settings) } : {}),
});
const item = (name: string, values: Record<string, string>, cols: Col[]): Item => ({
  id: name, name,
  values: cols.map((c) => ({ colId: c.id, title: c.title, type: c.type, text: values[c.id] ?? "" })),
});

function donorsBoard(): Board {
  const cols = [
    col("status", "סטטוס קשר", "status", {
      labels: [
        { id: 1, name: "פעיל", color: "#00c875" },
        { id: 2, name: "נותק", color: "#e2445c" },
      ],
    }),
    col("amount", "סכום תרומה", "numbers"),
    col("owner", "אחראי", "people"),
  ];
  const items = [
    item("תורם 1", { status: "פעיל", amount: "500", owner: "דנה" }, cols),
    item("תורם 2", { status: "נותק", amount: "300", owner: "יוסי" }, cols),
    item("תורם 3", { status: "פעיל", amount: "200", owner: "דנה" }, cols),
  ];
  return { id: "b1", name: "תורמים", columns: cols, items };
}

describe("computeSpecWidgets — הרכיבים שהאישור קבע, בסדר שהאישור קבע", () => {
  it("כל רכיב ב-spec מחושב מהמנוע ומחזיר נתונים אמיתיים", () => {
    const ws = computeSpecWidgets(donorsBoard(), {
      title: "תורמים",
      widgets: [
        { kind: "breakdown", col: "סטטוס קשר" },
        { kind: "numberSummary", col: "סכום תרומה" },
        { kind: "attention" },
      ],
    });
    expect(ws.map((w) => w.kind)).toEqual(["breakdown", "numberSummary", "attention"]);
    const bd = ws[0].data as { rows: { label: string; n: number }[] };
    expect(bd.rows.find((r) => r.label === "פעיל")?.n).toBe(2);
    const ns = ws[1].data as { sum: number };
    expect(ns.sum).toBe(1000);
    const att = ws[2].data as { count: number };
    expect(att.count).toBe(1); // "נותק" אדום ⇒ risk
  });

  it("רכיב שהלוח כבר לא תומך בו (עמודה נמחקה במונדיי) מדולג בשקט, לא קורס", () => {
    const ws = computeSpecWidgets(donorsBoard(), {
      title: "x",
      widgets: [
        { kind: "breakdown", col: "עמודה שנמחקה" },
        { kind: "list" },
      ],
    });
    expect(ws.map((w) => w.kind)).toEqual(["list"]);
  });
});
