/**
 * חוזה ה-spec של דשבורד שמור (גל 3) — השכבה שאוכפת את חוקי הוויזרד בקוד:
 * "רכיב שאין לו עמודה מתאימה לא קיים", "לא ממציאים", "4–8 רכיבים".
 * ה-AI רק מציע; מה שנשמר עובר דרך sanitizeSpec מול הפרופיל האמיתי,
 * ולכן פלט-AI עוין או שבור לעולם לא הופך לדשבורד שמצייר עמודות-רפאים.
 */
import { describe, it, expect } from "vitest";
import { sanitizeSpec, defaultSpec, ensureMentionedColumns } from "../dashboard-spec";
import { profileBoard } from "../board-profile";
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
  ];
  return { id: "b1", name: "תורמים", columns: cols, items };
}

const profile = () => profileBoard(donorsBoard());

describe("sanitizeSpec — פלט ה-AI עובר דרך הפרופיל, לא ישירות למסד", () => {
  it("רכיב שמצביע על עמודה קיימת ומהסוג הנכון — שורד", () => {
    const s = sanitizeSpec({ title: "תורמים", widgets: [{ kind: "breakdown", col: "סטטוס קשר" }] }, profile());
    expect(s.widgets).toEqual([{ kind: "breakdown", col: "סטטוס קשר" }]);
  });

  it("עמודת-רפאים שהומצאה — הרכיב נזרק", () => {
    const s = sanitizeSpec({ title: "x", widgets: [
      { kind: "breakdown", col: "עמודה שלא קיימת" },
      { kind: "attention" },
    ] }, profile());
    expect(s.widgets).toEqual([{ kind: "attention" }]);
  });

  it("סוג עמודה לא תואם (breakdown על עמודת מספר) — נזרק", () => {
    const s = sanitizeSpec({ title: "x", widgets: [
      { kind: "breakdown", col: "סכום תרומה" },
      { kind: "numberSummary", col: "סכום תרומה" },
    ] }, profile());
    expect(s.widgets).toEqual([{ kind: "numberSummary", col: "סכום תרומה" }]);
  });

  it("kind שלא ברשימה המותרת — נזרק; לכל היותר 8 רכיבים; כפילויות מאוחדות", () => {
    const many = Array.from({ length: 12 }, () => ({ kind: "attention" as const }));
    const s = sanitizeSpec({ title: "x", widgets: [
      { kind: "evilKind", col: "סטטוס קשר" },
      ...many,
      { kind: "list" },
    ] }, profile());
    expect(s.widgets.length).toBeLessThanOrEqual(8);
    expect(s.widgets.filter((w) => w.kind === "attention").length).toBe(1);
    expect(s.widgets.some((w) => (w.kind as string) === "evilKind")).toBe(false);
  });

  it("כותרת ארוכה/לא-מחרוזת נחתכת לגבולות; spec ריק לא קורס", () => {
    const s = sanitizeSpec({ title: "א".repeat(500), widgets: [] }, profile());
    expect(s.title.length).toBeLessThanOrEqual(80);
    expect(s.widgets).toEqual([]);
  });
});

describe("ensureMentionedColumns — מה שהתבקש בשמו חייב להופיע (משוב מיטל)", () => {
  it("עמודה שנוקבה בשמה במטרה ונשמטה מההצעה — נדחפת לראש ה-spec", () => {
    const s = ensureMentionedColumns(
      { title: "x", widgets: [{ kind: "attention" }] },
      "אני רוצה לעקוב אחרי סטטוס קשר",
      profile()
    );
    expect(s.widgets[0]).toEqual({ kind: "breakdown", col: "סטטוס קשר" });
  });

  it("עמודה מוזכרת שכבר בהצעה — לא מוכפלת", () => {
    const s = ensureMentionedColumns(
      { title: "x", widgets: [{ kind: "breakdown", col: "סטטוס קשר" }] },
      "פילוח סטטוס קשר",
      profile()
    );
    expect(s.widgets.filter((w) => w.col === "סטטוס קשר").length).toBe(1);
  });

  it("מטרה שלא מזכירה אף עמודה — ה-spec לא משתנה", () => {
    const spec = { title: "x", widgets: [{ kind: "attention" as const }] };
    expect(ensureMentionedColumns(spec, "שנדע מה קורה", profile())).toEqual(spec);
  });

  it("עמודת מספר מוזכרת מקבלת numberSummary, לא breakdown", () => {
    const s = ensureMentionedColumns({ title: "x", widgets: [] }, "כמה סכום תרומה נכנס", profile());
    expect(s.widgets[0]).toEqual({ kind: "numberSummary", col: "סכום תרומה" });
  });
});

describe("defaultSpec — הנפילה-הרכה כשה-AI לא זמין", () => {
  it("נגזר מתפריט הפרופיל עצמו: כל רכיב עם עמודה אמיתית, עד 6", () => {
    const p = profile();
    const s = defaultSpec(p);
    expect(s.widgets.length).toBeGreaterThan(0);
    expect(s.widgets.length).toBeLessThanOrEqual(6);
    const titles = new Set(p.columns.map((c) => c.title));
    for (const w of s.widgets) if (w.col) expect(titles.has(w.col)).toBe(true);
  });

  it("שם הדשבורד נגזר משם הלוח", () => {
    expect(defaultSpec(profile()).title).toContain("תורמים");
  });
});

/**
 * חיתוך פתוח (בקשת מיטל 2.9) נכנס לאותה חומה. חיתוך הוא הרכיב היחיד שנושא
 * מבנה מקונן — עמודת שורה, עמודת חיתוך, מדד ומסננים — ולכן הוא גם המקום היחיד
 * שבו ל-AI יש ארבע הזדמנויות להמציא עמודה במקום אחת. כל אחת מהן נחסמת כאן.
 */
describe("sanitizeSpec — רכיב חיתוך", () => {
  it("חיתוך תקין שורד במלואו", () => {
    const s = sanitizeSpec({ title: "ד", widgets: [
      { kind: "slice", slice: { rowCol: "אחראי", colCol: "סטטוס קשר" } },
    ] }, profile());
    expect(s.widgets).toHaveLength(1);
    expect(s.widgets[0].slice).toEqual({ rowCol: "אחראי", colCol: "סטטוס קשר" });
  });

  it("עמודת-שורה שאינה קיימת מפילה את הרכיב כולו", () => {
    const s = sanitizeSpec({ title: "ד", widgets: [
      { kind: "slice", slice: { rowCol: "עמודת רפאים", colCol: "סטטוס קשר" } },
    ] }, profile());
    expect(s.widgets).toHaveLength(0);
  });

  it("עמודת-חיתוך שאינה קיימת מוסרת, והחיתוך שורד כחד-ממדי", () => {
    const s = sanitizeSpec({ title: "ד", widgets: [
      { kind: "slice", slice: { rowCol: "אחראי", colCol: "רפאים" } },
    ] }, profile());
    expect(s.widgets).toHaveLength(1);
    expect(s.widgets[0].slice!.colCol).toBeUndefined();
  });

  it("מדד על עמודה שאינה מספר מוסר — סכום של סטטוסים הוא שטות", () => {
    const s = sanitizeSpec({ title: "ד", widgets: [
      { kind: "slice", slice: { rowCol: "אחראי", measure: { col: "סטטוס קשר", agg: "sum" } } },
    ] }, profile());
    expect(s.widgets[0].slice!.measure).toBeUndefined();
  });

  it("מדד תקין על עמודת מספר נשמר", () => {
    const s = sanitizeSpec({ title: "ד", widgets: [
      { kind: "slice", slice: { rowCol: "אחראי", measure: { col: "סכום תרומה", agg: "sum" } } },
    ] }, profile());
    expect(s.widgets[0].slice!.measure).toEqual({ col: "סכום תרומה", agg: "sum" });
  });

  it("פעולת-מדד לא מוכרת נדחית ולא נשמרת כמו שהיא", () => {
    const s = sanitizeSpec({ title: "ד", widgets: [
      { kind: "slice", slice: { rowCol: "אחראי", measure: { col: "סכום תרומה", agg: "drop_table" } } },
    ] }, profile());
    expect(s.widgets[0].slice!.measure).toBeUndefined();
  });

  it("מסנן על עמודת רפאים מוסר, ומסנן תקין נשאר", () => {
    const s = sanitizeSpec({ title: "ד", widgets: [
      { kind: "slice", slice: { rowCol: "אחראי", filters: [
        { col: "רפאים", op: "is", value: "x" },
        { col: "סטטוס קשר", op: "is", value: "פעיל" },
      ] } },
    ] }, profile());
    expect(s.widgets[0].slice!.filters).toEqual([{ col: "סטטוס קשר", op: "is", value: "פעיל" }]);
  });

  it("אופרטור מסנן זר נדחה", () => {
    const s = sanitizeSpec({ title: "ד", widgets: [
      { kind: "slice", slice: { rowCol: "אחראי", filters: [{ col: "סטטוס קשר", op: "eval", value: "x" }] } },
    ] }, profile());
    expect(s.widgets[0].slice!.filters ?? []).toHaveLength(0);
  });

  it("רכיב חיתוך בלי מבנה חיתוך כלל נופל", () => {
    const s = sanitizeSpec({ title: "ד", widgets: [{ kind: "slice" }] }, profile());
    expect(s.widgets).toHaveLength(0);
  });

  it("ציר לוח מותר — חיתוך חוצה-לוחות מאומת מול הלוחות עצמם, לא מול פרופיל אחד", () => {
    const s = sanitizeSpec({ title: "ד", widgets: [
      { kind: "slice", slice: { rowCol: "__board__", colCol: "סטטוס קשר" } },
    ] }, profile());
    expect(s.widgets).toHaveLength(1);
    expect(s.widgets[0].slice!.rowCol).toBe("__board__");
  });

  it("שני חיתוכים זהים מתמזגים לאחד", () => {
    const s = sanitizeSpec({ title: "ד", widgets: [
      { kind: "slice", slice: { rowCol: "אחראי", colCol: "סטטוס קשר" } },
      { kind: "slice", slice: { rowCol: "אחראי", colCol: "סטטוס קשר" } },
    ] }, profile());
    expect(s.widgets).toHaveLength(1);
  });

  it("שני חיתוכים שונים על אותה עמודת-שורה נשמרים שניהם", () => {
    const s = sanitizeSpec({ title: "ד", widgets: [
      { kind: "slice", slice: { rowCol: "אחראי", colCol: "סטטוס קשר" } },
      { kind: "slice", slice: { rowCol: "אחראי", measure: { col: "סכום תרומה", agg: "sum" } } },
    ] }, profile());
    expect(s.widgets).toHaveLength(2);
  });
});
