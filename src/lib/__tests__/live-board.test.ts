/**
 * "הלוח הרגוע" כפונקציה אחת (בקשת מיטל 2.9: "כל מה שקיים בדשבורדים שמחוברים
 * למונדיי יהיה גם כשמעלים גיליון").
 *
 * החישוב הזה חי עד היום בתוך `/api/dashboard` — ולכן היה זמין רק למי שמחובר.
 * כאן הוא הופך לפונקציה טהורה מעל `Board` + העדפות, וממנה קוראים גם הנתיב
 * וגם מסך הגיליון. אמת אחת, לא שתי מימושים שיתפצלו.
 *
 * מה שנבדק כאן הוא בדיוק מה שהיה חסר בגיליון: הדירוג, שכבת הרלוונטיות
 * (לוח לא נשפך), ⭐/✕, ומה שנפל — נופל ל"עוד רכיבים" ולא נעלם.
 */
import { describe, it, expect } from "vitest";
import { buildLiveBoard } from "../live-board";
import type { Board, Col, Item } from "../board-intelligence";

const col = (id: string, title: string, type: string, settings?: object): Col => ({
  id, title, type, ...(settings ? { settings_str: JSON.stringify(settings) } : {}),
});

const STATUS = { labels: [
  { id: 1, name: "פעיל", color: "#00c875" },
  { id: 2, name: "בסיכון", color: "#e2445c" },
  { id: 3, name: "הושלם", color: "#0086c0" },
] };

/** לוח עם עמודה שמספרת סיפור, עמודה שכולה ערך אחד, ומספר. */
function board(): Board {
  const cols = [
    col("st", "סטטוס", "status", STATUS),
    col("flat", "מחזור", "status", { labels: [{ id: 1, name: "תשפ״ה", color: "#c4c4c4" }] }),
    col("amt", "סכום", "numbers"),
    col("owner", "אחראי", "people"),
  ];
  const mk = (i: number, st: string, owner: string): Item => ({
    id: String(i), name: `רשומה ${i}`,
    values: [
      { colId: "st", title: "סטטוס", type: "status", text: st },
      { colId: "flat", title: "מחזור", type: "status", text: "תשפ״ה" },
      { colId: "amt", title: "סכום", type: "numbers", text: String(100 * i) },
      { colId: "owner", title: "אחראי", type: "people", text: owner },
    ],
  });
  return {
    id: "b1", name: "מוטבים", columns: cols,
    items: [
      mk(1, "פעיל", "דנה"), mk(2, "פעיל", "יוסי"), mk(3, "בסיכון", "דנה"),
      mk(4, "הושלם", "יוסי"), mk(5, "בסיכון", "דנה"), mk(6, "פעיל", "יוסי"),
    ],
  };
}

const one = (prefs = {}) => buildLiveBoard([{ board: board(), prefs }]);
const keys = (ws: { key: string }[]) => ws.map((w) => w.key);

describe("buildLiveBoard — הלוח לא נשפך", () => {
  it("עמודה שכל ערכיה זהים לא מגיעה ללוח — היא לא מספרת סיפור", () => {
    const d = one();
    expect(keys(d.charts)).not.toContain("breakdown|מחזור");
  });

  it("…אבל היא לא נעלמת: היא ב'עוד רכיבים', לחיצה מהחזרה", () => {
    const d = one();
    expect(keys(d.more)).toContain("breakdown|מחזור");
  });

  it("עמודה שכן מספרת סיפור מוצגת", () => {
    expect(keys(one().charts)).toContain("breakdown|סטטוס");
  });

  it("יש תקרה — לוח רחב לא מציג הכל", () => {
    expect(one().charts.length).toBeLessThanOrEqual(8);
  });
});

describe("buildLiveBoard — ⭐ ו-✕ של המשתמשת גוברים על הסטטיסטיקה", () => {
  it("רכיב מוצמד עולה לראש, גם אם שכבת הרלוונטיות פסלה אותו", () => {
    const d = one({ pinnedWidgets: ["breakdown|מחזור"] });
    expect(keys(d.charts)[0]).toBe("breakdown|מחזור");
    expect(d.charts[0].pinned).toBe(true);
  });

  it("רכיב שהוסתר יורד מהלוח ומסומן כמוסתר-בידי-המשתמשת", () => {
    const d = one({ hiddenWidgets: ["breakdown|סטטוס"] });
    expect(keys(d.charts)).not.toContain("breakdown|סטטוס");
    expect(d.more.find((m) => m.key === "breakdown|סטטוס")?.hiddenByUser).toBe(true);
  });

  it("עמודה שנקובה בשם במשפט-המטרה שורדת את הסינון — ערבות הבקשה המפורשת", () => {
    const d = one({ goalsText: "אני רוצה לראות את המחזור" });
    expect(keys(d.charts)).toContain("breakdown|מחזור");
  });
});

describe("buildLiveBoard — מה שכל פילוח נושא איתו", () => {
  it("כל פלח נושא את השמות שמאחוריו — פתיחת פילוח", () => {
    const w = one().charts.find((c) => c.key === "breakdown|סטטוס")!;
    expect(w.drill!["פעיל"]).toEqual(["רשומה 1", "רשומה 2", "רשומה 6"]);
    expect(w.drill!["בסיכון"]).toHaveLength(2);
  });

  it("הטון של כל תווית מגיע מהצבע שהלוח נתן לה", () => {
    const d = one();
    expect(d.tones["בסיכון"]).toBe("risk");
    expect(d.tones["פעיל"]).toBe("done");
  });

  it("הרשומות שדורשות תשומת לב נאספות בנפרד, לא ככרטיס", () => {
    const d = one();
    expect(d.attention.count).toBe(2);
    expect(d.attention.items.every((i) => i.board === "מוטבים")).toBe(true);
    expect(keys(d.charts)).not.toContain("attention|");
  });

  it("יש מדדי-כותרת", () => {
    expect(one().kpis.length).toBeGreaterThan(0);
  });
});

describe("buildLiveBoard — כמה לוחות יחד", () => {
  it("שם הלוח נוסף לכותרת רק כשיש יותר מאחד", () => {
    const single = one().charts.find((c) => c.key === "breakdown|סטטוס")!;
    expect(single.title).not.toContain("· מוטבים");

    const b2 = { ...board(), id: "b2", name: "תורמים" };
    const many = buildLiveBoard([{ board: board(), prefs: {} }, { board: b2, prefs: {} }]);
    expect(many.charts.some((c) => c.title.includes("· מוטבים"))).toBe(true);
    expect(many.source).toBe("מוטבים · תורמים");
  });

  it("העדפות הן פר-לוח — הסתרה בלוח אחד לא מסתירה בשני", () => {
    const b2 = { ...board(), id: "b2", name: "תורמים" };
    const d = buildLiveBoard([
      { board: board(), prefs: { hiddenWidgets: ["breakdown|סטטוס"] } },
      { board: b2, prefs: {} },
    ]);
    const shown = d.charts.filter((c) => c.key === "breakdown|סטטוס");
    expect(shown).toHaveLength(1);
    expect(shown[0].boardId).toBe("b2");
  });
});

describe("buildLiveBoard — קלט קצה", () => {
  it("בלי לוחות בכלל — מבנה ריק, בלי קריסה", () => {
    const d = buildLiveBoard([]);
    expect(d.charts).toEqual([]);
    expect(d.attention.count).toBe(0);
  });

  it("לוח בלי שורות — בלי כרטיסים מומצאים", () => {
    const empty = { ...board(), items: [] };
    const d = buildLiveBoard([{ board: empty, prefs: {} }]);
    expect(d.attention.count).toBe(0);
    expect(d.charts.every((c) => c.kind !== "attention")).toBe(true);
  });
});
