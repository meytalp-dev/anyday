/**
 * קיבוץ כללי — הלב של "חיתוך פתוח" (בקשת מיטל 2.9: "חיתוכים שונים של כל מיני
 * פרמטרים... הכל צריך להיות פתוח").
 *
 * עמודת סטטוס קלה לחיתוך: יש לה ארבע תוויות. אבל עמודת תרומות עם 900 סכומים
 * שונים היא לא חיתוך — היא רשימה. לכן כל עמודה, מכל טיפוס, עוברת דרך מקבץ אחד
 * שמחליט לפי **טיפוס העמודה** איך להפוך אותה לקטגוריות: תווית נשארת תווית,
 * מספר נחתך לטווחים, תאריך נחתך לחודש/רבעון/שנה לפי הטווח בפועל, וטקסט חופשי
 * מצטמצם לנפוצים + "אחר".
 *
 * עקרון הזהב נשמר: ההחלטה היא לפי טיפוס וצבע, לעולם לא לפי מילים בכותרת.
 */
import { describe, it, expect } from "vitest";
import { bucketize, EMPTY_KEY, OTHER_KEY } from "../slice-buckets";
import type { Col, Item } from "../board-intelligence";

const col = (id: string, title: string, type: string, settings?: object): Col => ({
  id, title, type, ...(settings ? { settings_str: JSON.stringify(settings) } : {}),
});

/** Items carrying one column's values, in order. */
const itemsWith = (c: Col, texts: string[]): Item[] =>
  texts.map((t, i) => ({ id: `i${i}`, name: `שורה ${i}`, values: [{ colId: c.id, title: c.title, type: c.type, text: t }] }));

const keysOf = (b: ReturnType<typeof bucketize>) => b.keys.map((k) => k.key);

describe("bucketize — עמודת תווית (status/dropdown)", () => {
  const LABELS = { labels: [
    { id: 1, name: "ממתין", color: "#e2445c" },
    { id: 2, name: "בטיפול", color: "#fdab3d" },
    { id: 3, name: "טופל", color: "#00c875" },
  ] };
  const c = col("st", "סטטוס טיפול", "status", LABELS);

  it("כל תווית היא קטגוריה — בלי טווחים ובלי המצאות", () => {
    const b = bucketize(c, itemsWith(c, ["טופל", "ממתין", "טופל"]));
    expect(b.mode).toBe("label");
    expect(keysOf(b).sort()).toEqual(["טופל", "ממתין"]);
  });

  it("הגוון של התווית הופך לטון — הצבע של הלוח, לא מילון מילים שלנו", () => {
    const b = bucketize(c, itemsWith(c, ["ממתין", "טופל"]));
    expect(b.keys.find((k) => k.key === "ממתין")!.tone).toBe("risk");
    expect(b.keys.find((k) => k.key === "טופל")!.tone).toBe("done");
  });

  it("סדר התוויות הוא הסדר שהוגדר בלוח, לא לפי כמות", () => {
    // "טופל" מופיע הכי הרבה אבל מוגדר אחרון — הסדר של הלוח מנצח.
    const b = bucketize(c, itemsWith(c, ["טופל", "טופל", "טופל", "ממתין"]));
    expect(keysOf(b)).toEqual(["ממתין", "טופל"]);
  });

  it("תא ריק מקבל מפתח מפורש — נספר, לא נעלם", () => {
    const b = bucketize(c, itemsWith(c, ["טופל", ""]));
    expect(keysOf(b)).toContain(EMPTY_KEY);
  });
});

describe("bucketize — עמודת מספר", () => {
  const c = col("amt", "סה\"כ תרומה", "numbers");

  it("הרבה ערכים שונים נחתכים לטווחים, לא לשורה פר סכום", () => {
    const texts = Array.from({ length: 60 }, (_, i) => String(i * 1000));
    const b = bucketize(c, itemsWith(c, texts));
    expect(b.mode).toBe("number");
    expect(b.keys.length).toBeGreaterThan(1);
    expect(b.keys.length).toBeLessThanOrEqual(8);
  });

  it("הטווחים עולים בסדר טבעי, לא לפי כמות", () => {
    const b = bucketize(c, itemsWith(c, ["100", "50000", "700", "25000"]));
    const lows = b.keys.map((k) => k.sort ?? 0);
    expect([...lows]).toEqual([...lows].sort((a, z) => a - z));
  });

  it("מעט ערכים שונים נשארים כמו שהם — דירוג 1–5 הוא לא טווחים", () => {
    const b = bucketize(c, itemsWith(c, ["1", "2", "3", "4", "5", "3", "2"]));
    expect(b.mode).toBe("label");
    expect(keysOf(b)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("טקסט שאינו מספר נופל לריק, לא ל-NaN", () => {
    const b = bucketize(c, itemsWith(c, ["1000", "לא ידוע", "2000"]));
    expect(keysOf(b)).toContain(EMPTY_KEY);
    expect(keysOf(b).some((k) => k.includes("NaN"))).toBe(false);
  });
});

describe("bucketize — עמודת תאריך", () => {
  const c = col("d", "תאריך גיוס", "date");

  it("טווח של חודשים — מקובץ לחודשים", () => {
    const b = bucketize(c, itemsWith(c, ["2024-01-15", "2024-02-03", "2024-03-20"]));
    expect(b.mode).toBe("date");
    expect(b.grain).toBe("month");
    expect(b.keys.length).toBe(3);
  });

  it("טווח של שנים רבות — מקובץ לשנים, לא ל-120 חודשים", () => {
    const texts = Array.from({ length: 10 }, (_, i) => `${2015 + i}-06-01`);
    const b = bucketize(c, itemsWith(c, texts));
    expect(b.grain).toBe("year");
    expect(keysOf(b)).toEqual(["2015", "2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024"]);
  });

  it("התאריכים עולים כרונולוגית", () => {
    const b = bucketize(c, itemsWith(c, ["2024-03-01", "2024-01-01", "2024-02-01"]));
    const s = b.keys.map((k) => k.sort ?? 0);
    expect([...s]).toEqual([...s].sort((a, z) => a - z));
  });

  it("תאריך לא תקין נופל לריק ולא שובר את הטווח", () => {
    const b = bucketize(c, itemsWith(c, ["2024-01-01", "מחר", ""]));
    expect(keysOf(b)).toContain(EMPTY_KEY);
  });
});

describe("bucketize — אנשים וטקסט", () => {
  it("עמודת אנשים מפצלת שמות מרובים — שורה נספרת לכל אחד", () => {
    const c = col("p", "אחראי", "people");
    const b = bucketize(c, itemsWith(c, ["דנה, יוסי", "דנה"]));
    expect(b.mode).toBe("people");
    expect(keysOf(b).sort()).toEqual(["דנה", "יוסי"]);
    expect(b.keyOf("דנה, יוסי")).toEqual(["דנה", "יוסי"]);
  });

  it("טקסט חופשי מצטמצם לנפוצים ועודף נכנס ל'אחר' — לא 400 שורות", () => {
    const c = col("t", "הערות", "text");
    const many = Array.from({ length: 40 }, (_, i) => `הערה ${i}`);
    const b = bucketize(c, itemsWith(c, [...many, "חוזר", "חוזר", "חוזר"]));
    expect(b.keys.length).toBeLessThanOrEqual(9);
    expect(keysOf(b)).toContain(OTHER_KEY);
    expect(keysOf(b)).toContain("חוזר");
  });
});

describe("bucketize — קלט עוין", () => {
  it("בלי שורות בכלל — אין מפתחות, בלי קריסה", () => {
    const c = col("st", "סטטוס", "status");
    expect(bucketize(c, []).keys).toEqual([]);
  });

  it("10,000 ערכים שונים בעמודת טקסט לא מייצרים 10,000 קטגוריות", () => {
    const c = col("t", "מזהה", "text");
    const texts = Array.from({ length: 10000 }, (_, i) => `id-${i}`);
    const b = bucketize(c, itemsWith(c, texts));
    expect(b.keys.length).toBeLessThanOrEqual(9);
  });

  it("כל הערכים זהים — קטגוריה אחת, וזה תקין", () => {
    const c = col("st", "סטטוס", "status");
    const b = bucketize(c, itemsWith(c, ["טופל", "טופל", "טופל"]));
    expect(b.keys.length).toBe(1);
  });
});
