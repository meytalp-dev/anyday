/**
 * חיתוך חוצה-לוחות (בקשת מיטל 1.9): "סטטוס טיפול" לא קיים בלוח הכללי אבל
 * קיים — בשמות מעט שונים — בלוח של כל בית ספר. המערכת צריכה לקרוא את העמודה
 * מכל לוח ולהציג פילוח אחד לפי לוח (=לפי בית ספר). אפס חישוב חדש: כל קבוצה
 * היא BI.breakdown של הלוח שלה; הקובץ הנבדק רק מאתר את העמודה בכל לוח
 * (בהתאמה הגמישה) ומאגד.
 */
import { describe, it, expect } from "vitest";
import { crossBreakdown, matchStatusColumn } from "../cross-board";
import type { Board, Col, Item } from "../board-intelligence";

const col = (id: string, title: string, type: string, settings?: object): Col => ({
  id, title, type, ...(settings ? { settings_str: JSON.stringify(settings) } : {}),
});
const item = (name: string, values: Record<string, string>, cols: Col[]): Item => ({
  id: name, name,
  values: cols.map((c) => ({ colId: c.id, title: c.title, type: c.type, text: values[c.id] ?? "" })),
});

const LABELS = {
  labels: [
    { id: 1, name: "בטיפול", color: "#fdab3d" },
    { id: 2, name: "טופל", color: "#00c875" },
  ],
};

function schoolBoard(name: string, colTitle: string, statuses: string[]): Board {
  const cols = [col("st", colTitle, "status", LABELS), col("phone", "טלפון", "phone")];
  return { id: name, name, columns: cols, items: statuses.map((s, i) => item(`${name}-${i}`, { st: s }, cols)) };
}

describe("matchStatusColumn — איתור העמודה בכל לוח, בשם שלו", () => {
  it("מוצא את הגרסה המקומית של העמודה: 'סטטוס טיפול (מילויי צוות)' עבור 'סטטוס טיפול'", () => {
    const b = schoolBoard("אשקלון", "סטטוס טיפול (מילויי צוות)", ["טופל"]);
    expect(matchStatusColumn(b, "סטטוס טיפול")?.title).toBe("סטטוס טיפול (מילויי צוות)");
  });

  it("לוח בלי עמודה מתאימה — null, בלי ניחוש", () => {
    const b = schoolBoard("כלל", "בית ספר", ["ירושלים"]);
    expect(matchStatusColumn(b, "סטטוס טיפול")).toBeNull();
  });
});

describe("crossBreakdown — פילוח אחד מכמה לוחות", () => {
  const boards = [
    schoolBoard("בית שאן", "סטטוס טיפול", ["בטיפול", "טופל", "טופל"]),
    schoolBoard("אשקלון", "סטטוס טיפול (מילויי צוות)", ["בטיפול", "בטיפול"]),
    schoolBoard("לוח בלי העמודה", "מגמה", ["הנדסה"]),
  ];

  it("קבוצה לכל לוח שיש בו את העמודה; לוח בלעדיה מדולג ומדווח", () => {
    const w = crossBreakdown(boards, "סטטוס טיפול")!;
    const d = w.data as { groups: { boardName: string }[]; skipped: string[] };
    expect(d.groups.map((g) => g.boardName)).toEqual(["בית שאן", "אשקלון"]);
    expect(d.skipped).toEqual(["לוח בלי העמודה"]);
  });

  it("הספירה בכל קבוצה נכונה, והגוון מגיע מצבע התווית של הלוח עצמו", () => {
    const w = crossBreakdown(boards, "סטטוס טיפול")!;
    const d = w.data as { groups: { boardName: string; total: number; rows: { label: string; n: number; tone: string }[] }[] };
    const beitShean = d.groups[0];
    expect(beitShean.total).toBe(3);
    expect(beitShean.rows.find((r) => r.label === "טופל")).toMatchObject({ n: 2, tone: "done" });
    const ashkelon = d.groups[1];
    expect(ashkelon.rows.find((r) => r.label === "בטיפול")).toMatchObject({ n: 2, tone: "progress" });
  });

  it("אין אף לוח מתאים — null, לא רכיב ריק", () => {
    expect(crossBreakdown([boards[2]], "סטטוס טיפול")).toBeNull();
  });
});
