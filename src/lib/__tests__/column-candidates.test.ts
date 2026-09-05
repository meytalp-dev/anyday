/**
 * "מצאתי 5 עמודות שיכולות לענות על זה" — הבורר (5.9).
 *
 * ארבעה סבבי תיקון על בקשה אחת נגמרו בהבנה שהשורש הוא לא באג: המערכת קראה את
 * שמות העמודות של 97 לוחות בשאילתה אחת, בחרה אחת מתוך **חמש**, ולא הראתה את
 * הבחירה. ניחוש מתוך רשימה סופית שאפשר להציג הוא כשל בעיצוב.
 *
 * הפונקציה כאן היא אותה ראיה שעליה `canonicalColumn` הכריעה — רק שהיא כבר לא
 * נבלעת. הכלל שנבדק כאן: **המספר שליד שם הוא מספר הלוחות שקוראים לעמודה שלהם
 * ככה** — לא כמה לוחות השם "מגיע" אליהם. המדד ההוא תגמל עמימות, ובגללו "היום"
 * ניצח את "מה עושה היום".
 */
import { describe, it, expect } from "vitest";
import { columnCandidates, canonicalColumn, type ColumnCandidate } from "../board-profile";

/** לוח בית ספר: שם, ועמודה אחת או יותר. */
const school = (id: string, name: string, titles: string[], rows: number, type = "status") => ({
  boardId: id,
  boardName: name,
  columns: titles.map((t) => ({ title: t, type })),
  rows,
});

/** מה ש-askedForElsewhere מחזירה לכל לוח: כל הכותרות שהתאימו למשפט. */
const hit = (b: { boardId: string; boardName: string; columns: { title: string }[] }, match: string[]) => ({
  boardId: b.boardId,
  boardName: b.boardName,
  columns: match,
});

describe("columnCandidates — הרשימה שמוצגת למשתמשת", () => {
  it("המקרה של מיטל: חמש מועמדות, ובראש מה ש-11 לוחות באמת קוראים לעמודה שלהם", () => {
    const boards = [
      ...Array.from({ length: 11 }, (_, i) => school(`s${i}`, `בוגרי ${i}`, ["שם", "מה עושה היום"], 100)),
      school("t1", "נוכחות א", ["הגיע/לא הגיע - היום לבית ספר"], 30),
      school("t2", "נוכחות ב", ["הגיע/לא הגיע - היום לבית ספר"], 30),
      school("d1", "מעקב א", ["היום"], 20, "date"),
      school("d2", "מעקב ב", ["היום"], 20, "date"),
      school("q1", "סקר", ["איפה רשימת הבוגרים מנוהלת היום?"], 5, "text"),
    ];
    const hits = boards.map((b) => hit(b, b.columns.map((c) => c.title).filter((t) => t.includes("היום"))));

    const cands = columnCandidates(hits, boards);

    expect(cands[0].column).toBe("מה עושה היום");
    expect(cands[0].boards).toHaveLength(11);
    expect(cands[0].rows).toBe(1100);
    expect(cands.map((c) => c.column)).toContain("היום");
    expect(cands.length).toBe(4);
  });

  it("המועמדת הראשונה היא בדיוק מה שהמנוע היה בוחר לבד — ברירת מחדל, לא הכרעה", () => {
    const boards = [
      school("a", "עכו", ["מה עושה היום"], 50),
      school("b", "אשקלון", ["מה עושה היום"], 50),
      school("c", "מעקב", ["היום"], 50, "date"),
    ];
    const hits = boards.map((b) => hit(b, b.columns.map((c) => c.title)));
    const cands = columnCandidates(hits, boards);

    expect(cands[0].column).toBe(
      canonicalColumn(hits.flatMap((h) => h.columns), boards.map((b) => ({ titles: b.columns.map((c) => c.title) })))
    );
  });

  it("הטיפוס נלקח מלוח שבאמת נושא את הכותרת — לא מנוחש", () => {
    const boards = [
      school("a", "עכו", ["מה עושה היום"], 10, "status"),
      school("c", "מעקב", ["היום"], 10, "date"),
    ];
    const hits = boards.map((b) => hit(b, b.columns.map((c) => c.title)));
    const by = Object.fromEntries(columnCandidates(hits, boards).map((c) => [c.column, c.bucket]));

    expect(by["מה עושה היום"]).toBe("status");
    expect(by["היום"]).toBe("date");
  });

  /* זה הלב. "היום" מוכלת בתוך "מה עושה היום", ולכן במדד ה"הגעה" היא קיבלה 17
     לוחות ו"מה עושה היום" קיבלה 13 — המילה הריקה ניצחה. אם המספר שמוצג ליד
     "היום" יהיה 13, הבורר רק יעביר את אותה עמימות למסך. */
  it("שם שרק מוכל בכותרות של לוחות אחרים לא סופר אותם כשלו", () => {
    const boards = [
      school("a", "עכו", ["מה עושה היום"], 10),
      school("b", "אשקלון", ["מה עושה היום"], 10),
      school("c", "מעקב", ["היום"], 10, "date"),
    ];
    const hits = boards.map((b) => hit(b, b.columns.map((c) => c.title)));
    const today = columnCandidates(hits, boards).find((c) => c.column === "היום")!;

    expect(today.boards).toHaveLength(1);
    expect(today.rows).toBe(10);
  });

  it("לוח שמאיית אחרת נספר בנפרד — 'בשם דומה', ולא מקופל לתוך המספר", () => {
    const boards = [
      school("a", "עכו", ["סטטוס טיפול"], 10),
      school("b", "אשקלון", ["סטטוס טיפול"], 10),
      school("c", "חיפה", ["סטטוס טיפול (מילויי צוות)"], 10),
    ];
    const hits = boards.map((b) => hit(b, b.columns.map((c) => c.title)));
    const main = columnCandidates(hits, boards).find((c) => c.column === "סטטוס טיפול")!;

    expect(main.boards.map((b) => b.boardId)).toEqual(["a", "b"]);
    expect(main.nearBoards.map((b) => b.boardId)).toEqual(["c"]);
  });

  it("לוח אחד שמחזיק שתי כותרות מתאימות תורם את שתיהן כמועמדות נפרדות", () => {
    const boards = [school("a", "עכו", ["היום", "מה עושה היום"], 40)];
    const cands = columnCandidates([hit(boards[0], ["היום", "מה עושה היום"])], boards);

    expect(cands.map((c) => c.column).sort()).toEqual(["היום", "מה עושה היום"].sort());
  });

  it("בלי התאמות — רשימה ריקה, לא ניחוש ולא רעש", () => {
    expect(columnCandidates([], [])).toEqual([] as ColumnCandidate[]);
  });
});
