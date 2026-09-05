/**
 * מה שהמשתמשת באמת קוראת ליד כל מועמדת — מקצה לקצה, על המספרים האמיתיים.
 *
 * הבדיקה הזו רצה את כל הצינור: המשפט החופשי → הלוחות שנמצאו → הרשימה
 * המדורגת → הכיסוי → השורה שמוצגת. היא קיימת כי הלקח השלישי מ-5.9 היה שטסט
 * ירוק שמקודד באג גרוע מהיעדר טסט: כשכותבים טסט לפונקציה חדשה — **מי צורך את
 * הפלט ולמה**. הצרכן כאן הוא מסך שמיטל תסתכל בו לפני שהיא בונה דשבורד, והפלט
 * הוא המשפט. אז זה מה שנבדק.
 */
import { describe, it, expect } from "vitest";
import { askedForElsewhere, columnCandidates } from "../board-profile";
import { summarizeFill, candidateFacts, fillLine, type BoardFill } from "../column-coverage";

/* חשבון ה-Monday האמיתי, כפי שנקרא ב-5.9 בשמות בלבד: "מה עושה היום" ב-11
   לוחות של בתי ספר, ועוד ארבע כותרות שמכילות את המילה "היום". */
const SCHOOLS = Array.from({ length: 11 }, (_, i) => ({
  boardId: `s${i}`, boardName: `בוגרי בית ספר ${i + 1}`,
  columns: [{ title: "שם מלא", type: "name" }, { title: "מה עושה היום", type: "status" }],
  rows: [300, 240, 200, 150, 100, 150, 40, 30, 20, 5, 5][i],
}));
const OTHERS = [
  ...SCHOOLS,
  { boardId: "a1", boardName: "נוכחות א", columns: [{ title: "הגיע/לא הגיע - היום לבית ספר", type: "status" }], rows: 80 },
  { boardId: "a2", boardName: "נוכחות ב", columns: [{ title: "הגיע/לא הגיע - היום לבית ספר", type: "status" }], rows: 60 },
  { boardId: "d1", boardName: "מעקב שיחות", columns: [{ title: "היום", type: "date" }], rows: 90 },
  { boardId: "d2", boardName: "יומן", columns: [{ title: "היום", type: "date" }], rows: 70 },
  { boardId: "q1", boardName: "סקר ארגונים", columns: [{ title: "איפה רשימת הבוגרים מנוהלת היום?", type: "text" }], rows: 12 },
];

/** הבקשה של מיטל, על הלוח המרכז שאין בו את העמודה. */
const run = () => {
  const hits = askedForElsewhere(
    "מה הבוגרים עושים היום לפי בית ספר",
    ["שם מלא", "בית ספר", "עיר", "שנת סיום"],
    OTHERS.map((b) => ({ boardId: b.boardId, boardName: b.boardName, titles: b.columns.map((c) => c.title) }))
  );
  return columnCandidates(hits, OTHERS);
};

describe("הבורר — מקצה לקצה על המקרה האמיתי", () => {
  it("מציג רשימה של כמה אפשרויות, לא הכרעה אחת", () => {
    expect(run().length).toBeGreaterThan(1);
  });

  it("בראש הרשימה — 11 לוחות ו-1,240 שורות, בלי שנקראה ולו שורה אחת", () => {
    const top = run()[0];
    expect(top.column).toBe("מה עושה היום");
    expect(candidateFacts(top)).toBe("11 לוחות · 1,240 שורות");
  });

  /* דשבורד חוצה-לוחות קורא עד 10 לוחות. כותרת שסופרת 11 מתארת משהו שלא ייבנה,
     ומעליה תופיע מדידה של 10 — שני מספרי שורות זה לצד זה, אף אחד מהם לא של
     הדשבורד. הכותרת סופרת את מה שייבנה, ואומרת את זה. */
  it("כשיש יותר לוחות ממה שדשבורד קורא — הכותרת סופרת את מה שייבנה", () => {
    expect(candidateFacts(run()[0], 10)).toBe("10 מתוך 11 לוחות · 1,235 שורות");
  });

  it("המילה הגנרית לא גונבת את הלוחות של הכותרת המפורשת", () => {
    const today = run().find((c) => c.column === "היום")!;
    expect(candidateFacts(today)).toBe("2 לוחות · 160 שורות");
  });

  /* הגילוי שמיטל עשתה ידנית, ושבגללו כל המסך הזה קיים. */
  it("הכיסוי נאמר לפני הבנייה: 286 מתוך 1,140 = 25%", () => {
    // ששת הלוחות הגדולים: 1,140 שורות, 286 מלאות — ושניים מהם על 0.
    const filled = [150, 100, 34, 0, 2, 0];
    const perBoard: BoardFill[] = SCHOOLS.slice(0, 6).map((b, i) => ({
      boardId: b.boardId, boardName: b.boardName, colTitle: "מה עושה היום",
      rows: b.rows, filled: filled[i], itemsCount: b.rows,
    }));
    const cov = summarizeFill("מה עושה היום", perBoard, 6);
    expect(fillLine(cov, false)).toBe("מלא ב-25% (286 מתוך 1,140)");
    expect(cov.emptyBoards).toEqual(["בוגרי בית ספר 4", "בוגרי בית ספר 6"]);
  });

  it("מדידה חלקית אומרת את עצמה באותה שורה, לא אחריה", () => {
    const partial = summarizeFill("מה עושה היום", [
      { boardId: "s0", boardName: "א", colTitle: "מה עושה היום", rows: 500, filled: 125, itemsCount: 1800 },
    ], 11, []);
    expect(fillLine(partial, false)).toBe("מלא ב-25% (125 מתוך 500) · נמדדו 1 מתוך 11 לוחות · מדגם");
  });

  it("עד שהמדידה חוזרת נאמר שהיא רצה — ולא מוצג 0%", () => {
    expect(fillLine(undefined, true)).toBe("בודקים כמה מזה מלא…");
    expect(fillLine(undefined, false)).toBe("");
  });
});
