/**
 * מנוע פרופיל-הלוח (W2-2 בלוח ה-BI) — "העיבוד שלנו על המאפיינים החשובים".
 *
 * המנוע דטרמיניסטי לחלוטין, בלי AI ובלי מילים: הוא מדרג עמודות לפי טיפוס,
 * מילוי ואיזון — הכללה של מדד-האיזון שכבר הוכח ב-/api/constellation. הפלט
 * שלו מזין את הוויזרד: אילו עמודות חשובות ואילו רכיבי-דשבורד הלוח באמת
 * תומך בהם.
 *
 * הבדיקות טוענות טענות יחסיות (מי מעל מי, מי בפנים ומי בחוץ) ולא מספרי-קסם,
 * כדי שכיול המשקולות לא ישבור אותן.
 */
import { describe, it, expect } from "vitest";
import { profileBoard, applyPreferences, selectLiveWidgets, hasSignal } from "../board-profile";
import type { Board, Col, Item } from "../board-intelligence";

/* ------------------------------------------------------------ בוני-עזר */

const col = (id: string, title: string, type: string, settings?: object): Col => ({
  id, title, type, ...(settings ? { settings_str: JSON.stringify(settings) } : {}),
});

const item = (name: string, values: Record<string, string>, cols: Col[]): Item => ({
  id: name, name,
  values: cols.map((c) => ({ colId: c.id, title: c.title, type: c.type, text: values[c.id] ?? "" })),
});

/** לוח תורמים ריאליסטי: סטטוס מאוזן, סכום מלא, טלפון חצי-ריק, עמודות-מטא. */
function donorsBoard(): Board {
  const cols = [
    col("status", "סטטוס קשר", "status", {
      labels: [
        { id: 1, name: "פעיל", color: "#00c875" },
        { id: 2, name: "בטיפול", color: "#fdab3d" },
        { id: 3, name: "נותק", color: "#e2445c" },
      ],
    }),
    col("amount", "סכום תרומה", "numbers"),
    col("phone", "טלפון", "phone"),
    col("owner", "אחראי", "people"),
    col("date", "תאריך תרומה אחרונה", "date"),
    col("created", "נוצר", "creation_log"),
    col("updated", "עודכן", "last_updated"),
  ];
  const rows: Record<string, string>[] = [
    { status: "פעיל", amount: "500", phone: "050-1111111", owner: "דנה", date: "2026-05-01" },
    { status: "פעיל", amount: "1200", owner: "דנה", date: "2026-06-11" },
    { status: "בטיפול", amount: "300", phone: "050-2222222", owner: "יוסי", date: "2026-04-20" },
    { status: "נותק", amount: "800", owner: "יוסי", date: "2025-12-05" },
    { status: "בטיפול", amount: "150", owner: "דנה", date: "2026-07-02" },
    { status: "פעיל", amount: "2000", phone: "050-3333333", owner: "רות", date: "2026-08-15" },
  ];
  return { id: "b1", name: "תורמים", columns: cols, items: rows.map((r, i) => item(`תורם ${i + 1}`, r, cols)) };
}

/* --------------------------------------------------------------- בדיקות */

describe("profileBoard — סיווג עמודות", () => {
  const p = profileBoard(donorsBoard());
  const byId = (id: string) => p.columns.find((c) => c.id === id)!;

  it("עמודות הנהלת-חשבונות של מונדיי (creation_log/last_updated) = meta, ציון 0", () => {
    expect(byId("created").bucket).toBe("meta");
    expect(byId("updated").bucket).toBe("meta");
    expect(byId("created").score).toBe(0);
    expect(byId("updated").score).toBe(0);
  });

  it("סטטוס/מספר/תאריך/אנשים מסווגים לדליים הסמנטיים שלהם", () => {
    expect(byId("status").bucket).toBe("status");
    expect(byId("amount").bucket).toBe("number");
    expect(byId("date").bucket).toBe("date");
    expect(byId("owner").bucket).toBe("people");
  });

  it("מילוי נמדד באחוזים מהשורות: טלפון מולא ב-3 מתוך 6", () => {
    expect(byId("phone").fillPct).toBe(50);
    expect(byId("amount").fillPct).toBe(100);
  });

  it("distinct סופר ערכים שונים שאינם ריקים", () => {
    expect(byId("status").distinct).toBe(3);
    expect(byId("owner").distinct).toBe(3);
  });
});

describe("profileBoard — דירוג חשיבות", () => {
  it("עמודת סטטוס מלאה ומאוזנת מדורגת מעל עמודה חצי-ריקה", () => {
    const p = profileBoard(donorsBoard());
    const status = p.columns.find((c) => c.id === "status")!;
    const phone = p.columns.find((c) => c.id === "phone")!;
    expect(status.score).toBeGreaterThan(phone.score);
  });

  it("columns ממוין מהציון הגבוה לנמוך", () => {
    const p = profileBoard(donorsBoard());
    const scores = p.columns.map((c) => c.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("פלח ענק (>70%) מוריד ציון: סטטוס חד-גוני מתחת לסטטוס מאוזן", () => {
    const balanced = col("s1", "מאוזן", "status", {
      labels: [
        { id: 1, name: "א", color: "#00c875" },
        { id: 2, name: "ב", color: "#fdab3d" },
      ],
    });
    const lopsided = col("s2", "חד-גוני", "status", {
      labels: [
        { id: 1, name: "כן", color: "#00c875" },
        { id: 2, name: "לא", color: "#e2445c" },
      ],
    });
    const cols = [balanced, lopsided];
    const items = Array.from({ length: 10 }, (_, i) =>
      item(`ר${i}`, { s1: i % 2 ? "א" : "ב", s2: i < 9 ? "כן" : "לא" }, cols)
    );
    const p = profileBoard({ id: "b", name: "לוח", columns: cols, items });
    const s1 = p.columns.find((c) => c.id === "s1")!;
    const s2 = p.columns.find((c) => c.id === "s2")!;
    expect(s2.dominantPct).toBe(90);
    expect(s1.score).toBeGreaterThan(s2.score);
  });

  it("important כולל את העמודות החזקות ולא כולל meta או עמודות כמעט-ריקות", () => {
    const p = profileBoard(donorsBoard());
    const ids = p.important.map((c) => c.id);
    expect(ids).toContain("status");
    expect(ids).toContain("amount");
    expect(ids).not.toContain("created");
    expect(ids).not.toContain("updated");
  });
});

describe("profileBoard — הצעת רכיבים", () => {
  it("כל רכיב מוצע נשען על עמודה שקיימת בלוח — ובסדר הציונים", () => {
    const p = profileBoard(donorsBoard());
    const colTitles = new Set(donorsBoard().columns.map((c) => c.title));
    for (const w of p.widgets) {
      if (w.col) expect(colTitles.has(w.col)).toBe(true);
    }
    // הרכיב הראשון שייך לעמודה עם הציון הגבוה ביותר מבין עמודות-הרכיבים
    expect(p.widgets[0].col).toBe(p.columns[0].title);
  });

  it("לוח בלי עמודת מספר לא מציע numberSummary", () => {
    const cols = [col("s", "סטטוס", "status", { labels: [{ id: 1, name: "א", color: "#00c875" }] })];
    const items = [item("ר1", { s: "א" }, cols)];
    const p = profileBoard({ id: "b", name: "לוח", columns: cols, items });
    expect(p.widgets.some((w) => w.kind === "numberSummary")).toBe(false);
  });
});

describe("applyPreferences — 'מה חשוב לך' גובר על הסטטיסטיקה (W2-3)", () => {
  it("עמודה מסומנת, גם חצי-ריקה, מדורגת מעל כל עמודה לא-מסומנת ונכנסת ל-important", () => {
    const p = applyPreferences(profileBoard(donorsBoard()), { importantColumns: ["phone"] });
    expect(p.columns[0].id).toBe("phone");
    expect(p.important.map((c) => c.id)).toContain("phone");
  });

  it("מזהה עמודה שלא קיים בלוח — מתעלמים, לא ממציאים", () => {
    const base = profileBoard(donorsBoard());
    const p = applyPreferences(base, { importantColumns: ["לא-קיימת"] });
    expect(p.columns.map((c) => c.id).sort()).toEqual(base.columns.map((c) => c.id).sort());
    expect(p.important.map((c) => c.id)).not.toContain("לא-קיימת");
  });

  it("עמודת meta מסומנת נשארת מתה — ציון 0 ולא ב-important", () => {
    const p = applyPreferences(profileBoard(donorsBoard()), { importantColumns: ["created"] });
    const created = p.columns.find((c) => c.id === "created")!;
    expect(created.score).toBe(0);
    expect(p.important.map((c) => c.id)).not.toContain("created");
  });

  it("בלי העדפות — הפרופיל חוזר זהה", () => {
    const base = profileBoard(donorsBoard());
    expect(applyPreferences(base, {})).toEqual(base);
  });

  it("הרכיבים עוקבים אחרי הדירוג החדש: תאריך מסומן ⇒ ציר-הזמן שלו ראשון", () => {
    const p = applyPreferences(profileBoard(donorsBoard()), { importantColumns: ["date"] });
    expect(p.widgets[0]).toMatchObject({ kind: "timeline", col: "תאריך תרומה אחרונה" });
  });

  it("עמודה שמוזכרת במשפט-המטרה נחשבת חשובה — הלוח מגיב למה שכתבו (משוב מיטל)", () => {
    // מיטל כתבה "סטטוס טיפול" בשדה המטרה וציפתה שהלוח יגיב. ההתאמה היא מול
    // כותרות העמודות של הלוח שלה עצמה — לא רשימת מילים שלנו (עקרון הזהב שמור).
    const p = applyPreferences(profileBoard(donorsBoard()), { goalsText: "לעקוב אחרי סכום תרומה של כל תורם" });
    expect(p.columns[0].title).toBe("סכום תרומה");
  });

  it("משפט-מטרה שלא מזכיר אף עמודה — הפרופיל נשאר כשהיה", () => {
    const base = profileBoard(donorsBoard());
    expect(applyPreferences(base, { goalsText: "שנדע מה קורה" })).toEqual(base);
  });

  it("הפרופיל המקורי לא משתנה (אין מוטציה)", () => {
    const base = profileBoard(donorsBoard());
    const before = JSON.parse(JSON.stringify(base));
    applyPreferences(base, { importantColumns: ["phone"] });
    expect(base).toEqual(before);
  });
});

describe("שכבת הרלוונטיות — מה מרוויח מקום על הלוח (משוב מיטל 1.9)", () => {
  /** לוח עם עמודה מספרת-סיפור ועמודה בלי שום סיפור (98% ערך אחד). */
  function noisyBoard(): Board {
    const cols = [
      col("status", "סטטוס", "status", {
        labels: [
          { id: 1, name: "פעיל", color: "#00c875" },
          { id: 2, name: "נותק", color: "#e2445c" },
        ],
      }),
      col("dull", "ארץ", "status", {
        labels: [{ id: 1, name: "ישראל", color: "#579bfc" }, { id: 2, name: "אחר", color: "#fdab3d" }],
      }),
      col("owner", "אחראי", "people"),
    ];
    const items = Array.from({ length: 50 }, (_, i) =>
      item(`ר${i}`, {
        status: i % 2 ? "פעיל" : "נותק",
        dull: i === 0 ? "אחר" : "ישראל", // 98% אותו ערך — צ'קבוקס מחופש לקטגוריה
        owner: "דנה",                    // אחראי יחיד — "חלוקה" בלי חלוקה
      }, cols)
    );
    return { id: "b", name: "לוח", columns: cols, items };
  }

  it("hasSignal: פילוח שכמעט כולו ערך אחד או חלוקה עם שם יחיד — בלי אות", () => {
    const p = profileBoard(noisyBoard());
    expect(hasSignal(p.columns.find((c) => c.id === "status")!)).toBe(true);
    expect(hasSignal(p.columns.find((c) => c.id === "dull")!)).toBe(false);
    expect(hasSignal(p.columns.find((c) => c.id === "owner")!)).toBe(false);
  });

  it("selectLiveWidgets: רכיבים בלי אות לא מוצגים — אבל לא נעלמים, הם ב-more", () => {
    const p = profileBoard(noisyBoard());
    const { show, more } = selectLiveWidgets(p, {});
    expect(show.some((w) => w.col === "ארץ")).toBe(false);
    expect(show.some((w) => w.col === "אחראי")).toBe(false);
    expect(more.some((w) => w.col === "ארץ")).toBe(true);
  });

  it("רכיב שהמשתמש הצמיד (⭐) מוצג ראשון — גם אם אין לו אות סטטיסטי", () => {
    const p = profileBoard(noisyBoard());
    const { show } = selectLiveWidgets(p, { pinnedWidgets: ["breakdown|ארץ"] });
    expect(show[0]).toMatchObject({ kind: "breakdown", col: "ארץ", pinned: true });
  });

  it("רכיב שהמשתמש הסתיר (✕) לא מוצג, גם עם אות — וזמין ב-more לשחזור", () => {
    const p = profileBoard(noisyBoard());
    const { show, more } = selectLiveWidgets(p, { hiddenWidgets: ["breakdown|סטטוס"] });
    expect(show.some((w) => w.col === "סטטוס")).toBe(false);
    expect(more.some((w) => w.col === "סטטוס")).toBe(true);
  });

  it("תקרה: לכל היותר 6 רכיבים מוצגים — לוח רגוע, לא עמוס", () => {
    const p = profileBoard(donorsBoard());
    const { show } = selectLiveWidgets(p, {});
    expect(show.length).toBeLessThanOrEqual(6);
  });

  it("הצמדת רכיב מקדמת את העמודה שלו גם בפרופיל (הוויזרד רואה את זה)", () => {
    const p = applyPreferences(profileBoard(donorsBoard()), { pinnedWidgets: ["numberSummary|סכום תרומה"] });
    expect(p.columns[0].title).toBe("סכום תרומה");
  });
});

describe("profileBoard — קצוות", () => {
  it("לוח ריק (0 שורות): לא קורס, מילוי 0, important ריק", () => {
    const cols = [col("s", "סטטוס", "status")];
    const p = profileBoard({ id: "b", name: "ריק", columns: cols, items: [] });
    expect(p.items).toBe(0);
    expect(p.columns[0].fillPct).toBe(0);
    expect(p.important).toEqual([]);
  });
});
