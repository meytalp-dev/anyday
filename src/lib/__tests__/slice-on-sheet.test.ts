/**
 * חיתוך על גיליון שהועלה (בקשת מיטל 2.9: "לעשות את אותן פעולות גם על גיליון
 * שאנחנו מעלים").
 *
 * זו הבדיקה שמוכיחה את הטענה המרכזית של AnyDay: המנוע לא יודע מאיפה הנתונים
 * באו. הוא מקבל `Board` ותו לא, ו-`planToBoard` מייצר בדיוק את הצורה הזאת
 * מקובץ CSV — בלי חשבון, בלי מונדיי, בלי שורת לוגיקה נוספת.
 *
 * לכן הבדיקה מתחילה מטקסט גולמי של קובץ, בדיוק כמו שהדפדפן קורא אותו,
 * ומסתיימת בטבלה צולבת. אם זה עובר, החיתוכים עובדים על גיליון.
 */
import { describe, it, expect } from "vitest";
import { readSheet, planToBoard } from "../sheet-to-board";
import { sliceBoard, sliceWidget } from "../slice";
import { bucketOf } from "../board-profile";

/**
 * גיליון בוגרים בגודל אמיתי. הגודל אינו קישוט: `inferType` מכריז על עמודה
 * כקטגוריה רק אם כל ערך חוזר בממוצע ‎3 פעמים לפחות (T.STATUS_MIN_REPEAT), ולכן
 * "סטטוס טיפול" בגיליון של שש שורות הוא טקסט חופשי — בכוונה. גיליון אמיתי של
 * בוגרים הוא מאות שורות, וזה מה שנבדק כאן.
 */
const SCHOOLS = ["אשקלון", "קרית מוצקין", "באר שבע"];
const STATUSES = ["טופל", "ממתין", "בטיפול"];
const YEARS = ["2023", "2024"];

function alumniCsv(rows = 120): string {
  const out = ["שם מלא,בית ספר,סטטוס טיפול,שנת סיום,סכום מלגה"];
  for (let i = 0; i < rows; i++) {
    out.push([
      `בוגר ${i}`,
      SCHOOLS[i % SCHOOLS.length],
      STATUSES[i % STATUSES.length],
      YEARS[i % YEARS.length],
      // סכומים אמיתיים משתנים. ערכים חוזרים מעטים היו מסווגים כקוד ולא כמדד
      // — וזו התנהגות נכונה: סכימה של קודים היא סכום חסר משמעות.
      String(1000 + i * 137),
    ].join(","));
  }
  return out.join("\n");
}

const CSV = alumniCsv();

const boardFromCsv = () => planToBoard(readSheet("בוגרים.csv", CSV));

const cellAt = (r: NonNullable<ReturnType<typeof sliceBoard>>, row: string, col?: string): number => {
  const ri = r.rowKeys.findIndex((k) => k.key === row);
  const ci = col ? r.colKeys.findIndex((k) => k.key === col) : 0;
  return ri < 0 || ci < 0 ? -1 : r.cells[ri][ci];
};

describe("הגיליון מגיע למנוע בלי מתרגם נוסף", () => {
  it("הקריאה מייצרת לוח עם העמודות והשורות של הקובץ", () => {
    const b = boardFromCsv();
    expect(b.items).toHaveLength(120);
    expect(b.columns.map((c) => c.title)).toContain("בית ספר");
    expect(b.columns.map((c) => c.title)).toContain("סטטוס טיפול");
  });

  it("הטיפוסים שנחשבו מהערכים הם אלה שהמקבץ יודע לעבוד איתם", () => {
    const b = boardFromCsv();
    const types = Object.fromEntries(b.columns.map((c) => [c.title, bucketOf(c.type)]));
    expect(types["בית ספר"]).toBe("status");
    expect(types["סטטוס טיפול"]).toBe("status");
    expect(types["סכום מלגה"]).toBe("number");
  });
});

describe("החיתוך שמיטל ביקשה — סטטוס טיפול לפי בית ספר, מגיליון", () => {
  it("הטבלה הצולבת נכונה תא-תא", () => {
    const b = boardFromCsv();
    const r = sliceBoard(b, { rowCol: "בית ספר", colCol: "סטטוס טיפול" })!;
    expect(r.rowKeys).toHaveLength(3);
    expect(r.colKeys).toHaveLength(3);
    expect(r.grandTotal).toBe(120);

    // נספר ישירות מהשורות, כדי שהבדיקה תמדוד את המנוע ולא תחזור על החישוב שלו.
    for (const school of SCHOOLS) {
      for (const status of STATUSES) {
        const expected = b.items.filter((it) =>
          it.values.find((v) => v.title === "בית ספר")?.text === school &&
          it.values.find((v) => v.title === "סטטוס טיפול")?.text === status
        ).length;
        expect(cellAt(r, school, status)).toBe(expected);
      }
    }
  });

  it("סכומי השוליים תואמים את הסכום הכולל", () => {
    const r = sliceBoard(boardFromCsv(), { rowCol: "בית ספר", colCol: "סטטוס טיפול" })!;
    expect(r.rowTotals.reduce((a, x) => a + x, 0)).toBe(120);
    expect(r.colTotals.reduce((a, x) => a + x, 0)).toBe(120);
  });

  it("מסנן על שנתון מצמצם, ומדווח על כמה מתוך כמה", () => {
    const r = sliceBoard(boardFromCsv(), {
      rowCol: "בית ספר", colCol: "סטטוס טיפול",
      filters: [{ col: "שנת סיום", op: "is", value: "2024" }],
    })!;
    expect(r.grandTotal).toBe(60);
    expect(r.matched).toBe(60);
    expect(r.ofTotal).toBe(120);
  });

  it("מדד מספרי מגיליון — סכום מלגות לפי בית ספר", () => {
    const b = boardFromCsv();
    const r = sliceBoard(b, { rowCol: "בית ספר", measure: { col: "סכום מלגה", agg: "sum" } })!;
    for (const school of SCHOOLS) {
      const expected = b.items
        .filter((it) => it.values.find((v) => v.title === "בית ספר")?.text === school)
        .reduce((sum, it) => sum + Number(it.values.find((v) => v.title === "סכום מלגה")?.text || 0), 0);
      expect(cellAt(r, school)).toBe(expected);
    }
  });

  it("הווידג'ט שמתרנדר במסך נבנה מהגיליון בדיוק כמו מלוח", () => {
    const w = sliceWidget([boardFromCsv()], { rowCol: "בית ספר", colCol: "סטטוס טיפול" })!;
    expect(w.kind).toBe("slice");
    expect(w.source).toContain("בוגרים");
  });

  it("עמודה שאינה בגיליון מחזירה null — המסך משמיט אותה במקום להציג תשובה ישנה", () => {
    expect(sliceBoard(boardFromCsv(), { rowCol: "עמודה שלא קיימת" })).toBeNull();
  });
});

/**
 * גיליון קטן מדי מכדי שעמודה תוכר כקטגוריה — המקרה שהתגלה בבנייה. החיתוך
 * חייב לעבוד גם אז: המקבץ יודע לקבץ טקסט חופשי (הנפוצים + "אחר"), ולכן
 * התשובה נשארת נכונה במקום להיעלם. סף הטיפוסים משפיע על השם, לא על היכולת.
 */
describe("גיליון קטן — הטיפוס יוצא טקסט, והחיתוך עדיין נכון", () => {
  const TINY = [
    "שם,בית ספר,סטטוס טיפול",
    "א,אשקלון,טופל",
    "ב,אשקלון,טופל",
    "ג,אשקלון,ממתין",
    "ד,קרית מוצקין,בטיפול",
    "ה,קרית מוצקין,ממתין",
    "ו,קרית מוצקין,ממתין",
  ].join("\n");
  const tiny = () => planToBoard(readSheet("קטן.csv", TINY));

  it("העמודה אכן לא הוכרה כקטגוריה — הסף עשה את שלו", () => {
    const t = tiny().columns.find((c) => c.title === "סטטוס טיפול")!;
    expect(bucketOf(t.type)).toBe("text");
  });

  it("ובכל זאת הטבלה הצולבת נכונה", () => {
    const r = sliceBoard(tiny(), { rowCol: "בית ספר", colCol: "סטטוס טיפול" })!;
    expect(cellAt(r, "אשקלון", "טופל")).toBe(2);
    expect(cellAt(r, "אשקלון", "ממתין")).toBe(1);
    expect(cellAt(r, "קרית מוצקין", "ממתין")).toBe(2);
    expect(r.grandTotal).toBe(6);
  });
});
