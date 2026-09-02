/**
 * מנוע החיתוך הכללי (בקשת מיטל 2.9). עד היום כל ווידג'ט היה פונקציה נפרדת:
 * פילוח לפי סטטוס, חלוקה לפי אחראי, סיכום מספר. כל אחד חד-ממדי, כל אחד נעול
 * לטיפוס עמודה אחד. "הכל צריך להיות פתוח" = בקשה אחת גנרית:
 *
 *     קבץ לפי X · חתוך עם Y · מדוד Z · רק כאשר F
 *
 * מכאן הכל נגזר: פילוח רגיל הוא בקשה בלי Y, טבלה צולבת היא בקשה עם Y, וחיתוך
 * חוצה-לוחות הוא בקשה שבה הלוח עצמו הוא הציר. אין מקרים מיוחדים בקוד — ולכן
 * אין גבול למה שהלקוח יכול לבקש.
 *
 * המנוע טהור ומקבל `Board` בלבד, ולכן הוא עובד זהה על לוח מונדיי ועל גיליון
 * שהועלה (`planToBoard` מייצר את אותה צורה) — בלי שורת לוגיקה נוספת.
 */
import { describe, it, expect } from "vitest";
import { sliceBoard, sliceBoards, sliceWidget, BOARD_AXIS, type SliceSpec } from "../slice";
import type { Board, Col, Item } from "../board-intelligence";

const col = (id: string, title: string, type: string, settings?: object): Col => ({
  id, title, type, ...(settings ? { settings_str: JSON.stringify(settings) } : {}),
});

const STATUS = { labels: [
  { id: 1, name: "ממתין", color: "#e2445c" },
  { id: 2, name: "בטיפול", color: "#fdab3d" },
  { id: 3, name: "טופל", color: "#00c875" },
] };

const COLS: Col[] = [
  col("st", "סטטוס טיפול", "status", STATUS),
  col("school", "בית ספר", "dropdown"),
  col("year", "שנת סיום", "dropdown"),
  col("amt", "סה\"כ תרומה", "numbers"),
  col("owner", "אחראי", "people"),
];

const row = (id: string, v: Partial<Record<string, string>>): Item => ({
  id, name: `בוגר ${id}`,
  values: COLS.map((c) => ({ colId: c.id, title: c.title, type: c.type, text: v[c.id] ?? "" })),
});

/** ששה בוגרים, שני בתי ספר, שני שנתונים. */
const BOARD: Board = {
  id: "b1", name: "כלל הבוגרים", columns: COLS,
  items: [
    row("1", { st: "טופל",   school: "אשקלון",      year: "2024", amt: "1000", owner: "דנה" }),
    row("2", { st: "טופל",   school: "אשקלון",      year: "2023", amt: "2000", owner: "דנה" }),
    row("3", { st: "ממתין",  school: "אשקלון",      year: "2024", amt: "500",  owner: "יוסי" }),
    row("4", { st: "בטיפול", school: "קרית מוצקין", year: "2024", amt: "3000", owner: "יוסי" }),
    row("5", { st: "ממתין",  school: "קרית מוצקין", year: "2023", amt: "0",    owner: "" }),
    row("6", { st: "ממתין",  school: "קרית מוצקין", year: "2023", amt: "1500", owner: "דנה" }),
  ],
};

/** Cell lookup by label, so tests read like the screen. */
function cell(r: NonNullable<ReturnType<typeof sliceBoard>>, rowKey: string, colKey?: string): number {
  const ri = r.rowKeys.findIndex((k) => k.key === rowKey);
  const ci = colKey ? r.colKeys.findIndex((k) => k.key === colKey) : 0;
  if (ri < 0 || ci < 0) return -1;
  return r.cells[ri][ci];
}

describe("חיתוך חד-ממדי — פילוח רגיל הוא רק מקרה פרטי", () => {
  it("קיבוץ לפי עמודה אחת סופר נכון", () => {
    const r = sliceBoard(BOARD, { rowCol: "בית ספר" })!;
    expect(cell(r, "אשקלון")).toBe(3);
    expect(cell(r, "קרית מוצקין")).toBe(3);
    expect(r.grandTotal).toBe(6);
  });

  it("בלי ציר שני אין עמודות — התוצאה נשארת רשימה", () => {
    const r = sliceBoard(BOARD, { rowCol: "בית ספר" })!;
    expect(r.colKeys.length).toBeLessThanOrEqual(1);
  });

  it("עמודה שאינה קיימת בלוח מחזירה null — בלי ניחוש ובלי עמודה קרובה", () => {
    expect(sliceBoard(BOARD, { rowCol: "עמודת רפאים" })).toBeNull();
  });
});

describe("טבלה צולבת — X לפי Y, מה שהיה חסר", () => {
  const spec: SliceSpec = { rowCol: "בית ספר", colCol: "סטטוס טיפול" };

  it("כל תא הוא הצטלבות אמיתית של שני הערכים", () => {
    const r = sliceBoard(BOARD, spec)!;
    expect(cell(r, "אשקלון", "טופל")).toBe(2);
    expect(cell(r, "אשקלון", "ממתין")).toBe(1);
    expect(cell(r, "אשקלון", "בטיפול")).toBe(0);
    expect(cell(r, "קרית מוצקין", "ממתין")).toBe(2);
  });

  it("סכומי שוליים תואמים את התאים", () => {
    const r = sliceBoard(BOARD, spec)!;
    const ash = r.rowKeys.findIndex((k) => k.key === "אשקלון");
    expect(r.rowTotals[ash]).toBe(3);
    expect(r.colTotals.reduce((a, b) => a + b, 0)).toBe(6);
    expect(r.grandTotal).toBe(6);
  });

  it("הטון של עמודות הסטטוס נשמר — הצבע עובר לטבלה", () => {
    const r = sliceBoard(BOARD, spec)!;
    expect(r.colKeys.find((k) => k.key === "ממתין")!.tone).toBe("risk");
    expect(r.colKeys.find((k) => k.key === "טופל")!.tone).toBe("done");
  });

  it("שני צירים מאותה עמודה נחסמים — טבלה של עמודה מול עצמה היא רעש", () => {
    expect(sliceBoard(BOARD, { rowCol: "בית ספר", colCol: "בית ספר" })).toBeNull();
  });
});

describe("מדדים — לא רק לספור", () => {
  it("סכום עמודת מספר לפי קבוצה", () => {
    const r = sliceBoard(BOARD, { rowCol: "בית ספר", measure: { col: "סה\"כ תרומה", agg: "sum" } })!;
    expect(cell(r, "אשקלון")).toBe(3500);
    expect(cell(r, "קרית מוצקין")).toBe(4500);
  });

  it("ממוצע מתעלם משורות בלי ערך, ולא מחלק בהן", () => {
    const r = sliceBoard(BOARD, { rowCol: "אחראי", measure: { col: "סה\"כ תרומה", agg: "avg" } })!;
    // דנה: 1000, 2000, 1500 -> 1500
    expect(cell(r, "דנה")).toBe(1500);
  });

  it("מינימום ומקסימום", () => {
    const mx = sliceBoard(BOARD, { rowCol: "בית ספר", measure: { col: "סה\"כ תרומה", agg: "max" } })!;
    expect(cell(mx, "קרית מוצקין")).toBe(3000);
    const mn = sliceBoard(BOARD, { rowCol: "בית ספר", measure: { col: "סה\"כ תרומה", agg: "min" } })!;
    expect(cell(mn, "קרית מוצקין")).toBe(0);
  });

  it("מדד על עמודה שאינה מספר נדחה — סכום של שמות הוא שטות", () => {
    expect(sliceBoard(BOARD, { rowCol: "בית ספר", measure: { col: "סטטוס טיפול", agg: "sum" } })).toBeNull();
  });

  it("המדד מקבל תווית קריאה — המסך לא צריך לנחש מה המספר אומר", () => {
    const r = sliceBoard(BOARD, { rowCol: "בית ספר", measure: { col: "סה\"כ תרומה", agg: "sum" } })!;
    expect(r.measureLabel).toContain("סה\"כ תרומה");
    const c = sliceBoard(BOARD, { rowCol: "בית ספר" })!;
    expect(c.measureLabel).toBeTruthy();
  });
});

describe("מסננים — 'רק כאשר'", () => {
  it("שוויון מצמצם את הבסיס", () => {
    const r = sliceBoard(BOARD, { rowCol: "בית ספר", filters: [{ col: "שנת סיום", op: "is", value: "2024" }] })!;
    expect(cell(r, "אשקלון")).toBe(2);
    expect(cell(r, "קרית מוצקין")).toBe(1);
    expect(r.grandTotal).toBe(3);
  });

  it("התוצאה מדווחת כמה שורות נשארו מתוך כמה — שקיפות, לא רק המספר", () => {
    const r = sliceBoard(BOARD, { rowCol: "בית ספר", filters: [{ col: "שנת סיום", op: "is", value: "2024" }] })!;
    expect(r.matched).toBe(3);
    expect(r.ofTotal).toBe(6);
  });

  it("שלילה, הכלה, וגדול-מ", () => {
    const not = sliceBoard(BOARD, { rowCol: "בית ספר", filters: [{ col: "שנת סיום", op: "isNot", value: "2024" }] })!;
    expect(not.grandTotal).toBe(3);
    const has = sliceBoard(BOARD, { rowCol: "בית ספר", filters: [{ col: "בית ספר", op: "contains", value: "קרית" }] })!;
    expect(has.grandTotal).toBe(3);
    const gt = sliceBoard(BOARD, { rowCol: "בית ספר", filters: [{ col: "סה\"כ תרומה", op: "gt", value: "1000" }] })!;
    expect(gt.grandTotal).toBe(3); // 2000, 3000, 1500
  });

  it("כמה מסננים פועלים יחד (וגם, לא או)", () => {
    const r = sliceBoard(BOARD, { rowCol: "בית ספר", filters: [
      { col: "שנת סיום", op: "is", value: "2023" },
      { col: "סה\"כ תרומה", op: "gt", value: "1000" },
    ] })!;
    expect(r.grandTotal).toBe(2); // בוגר 2 (2000) ובוגר 6 (1500)
  });

  it("מסנן על עמודה לא קיימת מבוטל בשקט ולא מאפס את התוצאה", () => {
    const r = sliceBoard(BOARD, { rowCol: "בית ספר", filters: [{ col: "אין כזו", op: "is", value: "x" }] })!;
    expect(r.grandTotal).toBe(6);
  });

  it("מסנן שלא משאיר כלום מחזיר תוצאה ריקה מוצהרת, לא null", () => {
    const r = sliceBoard(BOARD, { rowCol: "בית ספר", filters: [{ col: "שנת סיום", op: "is", value: "1999" }] })!;
    expect(r.grandTotal).toBe(0);
    expect(r.matched).toBe(0);
    expect(r.ofTotal).toBe(6);
  });
});

describe("חוצה-לוחות — הלוח עצמו הוא ציר", () => {
  const ashkelon: Board = {
    id: "s1", name: "אשקלון",
    columns: [col("st", "סטטוס טיפול (מילויי צוות)", "status", STATUS)],
    items: ["טופל", "טופל", "ממתין"].map((s, i) => ({
      id: `a${i}`, name: `a${i}`, values: [{ colId: "st", title: "סטטוס טיפול (מילויי צוות)", type: "status", text: s }],
    })),
  };
  const motzkin: Board = {
    id: "s2", name: "קרית מוצקין",
    columns: [col("stat", "סטטוס טיפול", "status", STATUS)],
    items: ["בטיפול", "ממתין"].map((s, i) => ({
      id: `m${i}`, name: `m${i}`, values: [{ colId: "stat", title: "סטטוס טיפול", type: "status", text: s }],
    })),
  };
  const noStatus: Board = {
    id: "s3", name: "כלל הבוגרים",
    columns: [col("city", "עיר", "dropdown")],
    items: [{ id: "x", name: "x", values: [{ colId: "city", title: "עיר", type: "dropdown", text: "חיפה" }] }],
  };

  it("אותה עמודה בשם מקומי שונה בכל לוח — נמצאת בשניהם", () => {
    const r = sliceBoards([ashkelon, motzkin], { rowCol: BOARD_AXIS, colCol: "סטטוס טיפול" })!;
    expect(r.rowKeys.map((k) => k.key)).toEqual(["אשקלון", "קרית מוצקין"]);
    expect(cell(r, "אשקלון", "טופל")).toBe(2);
    expect(cell(r, "קרית מוצקין", "בטיפול")).toBe(1);
  });

  it("לוח בלי העמודה נקוב בשם — פילוח ששותק על בית ספר משקר", () => {
    const r = sliceBoards([ashkelon, motzkin, noStatus], { rowCol: BOARD_AXIS, colCol: "סטטוס טיפול" })!;
    expect(r.skipped).toContain("כלל הבוגרים");
    expect(r.rowKeys.map((k) => k.key)).not.toContain("כלל הבוגרים");
  });

  it("אף לוח בלי העמודה — null, ולא טבלה ריקה שנראית כמו אפס", () => {
    expect(sliceBoards([noStatus], { rowCol: BOARD_AXIS, colCol: "סטטוס טיפול" })).toBeNull();
  });

  it("מדד מספרי חוצה לוחות — סכום לפי לוח", () => {
    const mk = (name: string, amounts: string[]): Board => ({
      id: name, name, columns: [col("amt", "סה\"כ תרומה", "numbers")],
      items: amounts.map((a, i) => ({ id: `${name}${i}`, name: `${name}${i}`, values: [{ colId: "amt", title: "סה\"כ תרומה", type: "numbers", text: a }] })),
    });
    const r = sliceBoards([mk("א", ["100", "200"]), mk("ב", ["50"])], {
      rowCol: BOARD_AXIS, measure: { col: "סה\"כ תרומה", agg: "sum" },
    })!;
    expect(cell(r, "א")).toBe(300);
    expect(cell(r, "ב")).toBe(50);
  });
});

describe("sliceWidget — הצורה שנשמרת ומתרנדרת", () => {
  it("מייצר ווידג'ט מסוג slice עם כותרת שמסבירה את עצמה", () => {
    const w = sliceWidget([BOARD], { rowCol: "בית ספר", colCol: "סטטוס טיפול" })!;
    expect(w.kind).toBe("slice");
    expect(w.title).toContain("בית ספר");
    expect(w.title).toContain("סטטוס טיפול");
  });

  it("בקשה בלתי אפשרית מחזירה null ולא ווידג'ט ריק", () => {
    expect(sliceWidget([BOARD], { rowCol: "עמודת רפאים" })).toBeNull();
  });

  it("המקור נוקב בלוח — המשתמשת רואה מאיפה המספר בא", () => {
    const w = sliceWidget([BOARD], { rowCol: "בית ספר" })!;
    expect(w.source).toContain("כלל הבוגרים");
  });
});

describe("גבולות — טבלה חייבת להישאר קריאה", () => {
  it("עמודה עם מאות ערכים לא מייצרת מאות שורות בטבלה", () => {
    const c = col("t", "מזהה", "text");
    const big: Board = {
      id: "big", name: "גדול", columns: [c],
      items: Array.from({ length: 500 }, (_, i) => ({
        id: `${i}`, name: `${i}`, values: [{ colId: "t", title: "מזהה", type: "text", text: `v${i}` }],
      })),
    };
    const r = sliceBoard(big, { rowCol: "מזהה" })!;
    expect(r.rowKeys.length).toBeLessThanOrEqual(9);
    expect(r.grandTotal).toBe(500); // שום שורה לא אבדה — היא נכנסה ל"אחר"
  });
});
