/**
 * הכיסוי נאמר לפני הבנייה, לא מתגלה אחריה (מיטל, 5.9).
 *
 * המספרים כאן הם המספרים האמיתיים שהיא מצאה ידנית: "מה עושה היום" ב-11 לוחות,
 * 1,140 שורות, 286 מלאות — 25%. ושניים מהלוחות עם 0 ו-2.
 */
import { describe, it, expect } from "vitest";
import { summarizeFill, isFilled, type BoardFill } from "../column-coverage";

const b = (name: string, rows: number, filled: number, itemsCount = rows): BoardFill => ({
  boardId: name, boardName: name, colTitle: "מה עושה היום", rows, filled, itemsCount,
});

describe("isFilled", () => {
  it("תא ריק, רווחים ו-null אינם ערך", () => {
    expect(isFilled("")).toBe(false);
    expect(isFilled("   ")).toBe(false);
    expect(isFilled(null)).toBe(false);
    expect(isFilled(undefined)).toBe(false);
  });
  it("כל טקסט אחר — כן", () => {
    expect(isFilled("לומד")).toBe(true);
    expect(isFilled("0")).toBe(true);
  });
});

describe("summarizeFill", () => {
  it("המספרים של מיטל: 286 מתוך 1,140 = 25%", () => {
    const boards = [
      b("בית הערבה", 300, 150), b("עכו", 240, 100), b("אשקלון", 200, 34),
      b("קריית מוצקין", 150, 0), b("חדרה", 100, 2), b("נתניה", 150, 0),
    ];
    const cov = summarizeFill("מה עושה היום", boards, 6);
    expect(cov.rows).toBe(1140);
    expect(cov.filled).toBe(286);
    expect(cov.fillPct).toBe(25);
  });

  it("לוח שאין בו אף ערך נאמר בשמו — 'לא נאסף', ולא 'אף אחד לא עושה כלום'", () => {
    const cov = summarizeFill("מה עושה היום", [b("קריית מוצקין", 150, 0), b("עכו", 100, 40)], 2);
    expect(cov.emptyBoards).toEqual(["קריית מוצקין"]);
  });

  it("לוח בלי שורות בכלל אינו 'לוח ריק' — אין שם מה למלא", () => {
    const cov = summarizeFill("מה עושה היום", [b("חדש", 0, 0), b("עכו", 100, 40)], 2);
    expect(cov.emptyBoards).toEqual([]);
  });

  /* הלקח הרביעי מ-5.9: תנאי גורף על השלם מסתיר כשל בחלק. אחוז שממוצע על שמונה
     לוחות בזמן שהתווית אומרת אחד-עשר הוא בדיוק המספר ששורד עד ישיבת הנהלה. */
  it("לוח שלא נמדד — נספר ונאמר, לא נבלע בממוצע", () => {
    const cov = summarizeFill("מה עושה היום", [b("עכו", 100, 40)], 3, ["חיפה", "אילת"]);
    expect(cov.boardsAsked).toBe(3);
    expect(cov.boardsMeasured).toBe(1);
    expect(cov.missingBoards).toEqual(["חיפה", "אילת"]);
  });

  it("קריאה חלקית של לוח מסמנת שהאחוז הוא מדגם", () => {
    expect(summarizeFill("x", [b("ענק", 500, 250, 1800)], 1).truncated).toBe(true);
    expect(summarizeFill("x", [b("קטן", 120, 60, 120)], 1).truncated).toBe(false);
  });

  it("בלי שורות בכלל — 0%, ולא חלוקה באפס", () => {
    const cov = summarizeFill("x", [b("ריק", 0, 0)], 1);
    expect(cov.fillPct).toBe(0);
    expect(cov.perBoard[0].fillPct).toBe(0);
  });
});
