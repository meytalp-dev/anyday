/**
 * "ביקשתי סטטוס טיפול של כל הבוגרים — קיבלתי רק פילוח לפי בית ספר" (מיטל, 5.9).
 *
 * הפיצ'ר ששולח למקום הנכון היה קיים, אבל נדלק רק כשהמשפט לא הזכיר **אף**
 * עמודה מקומית. משפט שמערבב דבר שקיים כאן עם דבר שלא — סיפק את התנאי, והחצי
 * החסר נפל בשקט. הבדיקה עברה מרמת המשפט לרמת העמודה.
 */
import { describe, it, expect } from "vitest";
import { askedForElsewhere } from "../board-profile";

const OTHERS = [
  { boardId: "b2", boardName: "בוגרי בית הערבה", titles: ["שם", "סטטוס טיפול", "מלגה"] },
  { boardId: "b3", boardName: "בוגרי עכו", titles: ["שם", "סטטוס טיפול"] },
];

describe("askedForElsewhere", () => {
  it("המקרה של מיטל: משפט שמערבב עמודה שקיימת עם אחת שלא — מדווח על החסרה", () => {
    const hits = askedForElsewhere(
      "סטטוס הטיפול של כל הבוגרים לפי בית ספר",
      ["שם מלא", "בית ספר", "עיר", "שנת סיום"],
      OTHERS
    );
    expect(hits.map((h) => h.column)).toContain("סטטוס טיפול");
  });

  it("לא מדווח על מה שהלוח הזה כן יודע לענות", () => {
    const hits = askedForElsewhere("פילוח לפי בית ספר", ["בית ספר"], [
      { boardId: "b2", boardName: "אחר", titles: ["בית ספר"] },
    ]);
    expect(hits).toHaveLength(0);
  });

  it("עמודה שקיימת כאן בשם דומה נחשבת זמינה, ולא מדווחת כחסרה", () => {
    const hits = askedForElsewhere("מה סטטוס הטיפול?", ["סטטוס"], OTHERS);
    expect(hits).toHaveLength(0);
  });

  it("אותה עמודה בכמה לוחות מדווחת פעם אחת", () => {
    const hits = askedForElsewhere("סטטוס טיפול", ["עיר"], OTHERS);
    expect(hits.filter((h) => h.column === "סטטוס טיפול")).toHaveLength(1);
  });

  it("משפט ריק או כללי לא מייצר רעש", () => {
    expect(askedForElsewhere("", ["עיר"], OTHERS)).toHaveLength(0);
    expect(askedForElsewhere("שיהיה יפה", ["עיר"], OTHERS)).toHaveLength(0);
  });
});
