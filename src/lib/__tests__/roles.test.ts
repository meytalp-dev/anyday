/**
 * סולם ההרשאות.
 *
 * הרקע: `viewer` נחסם משמירת דשבורד, אבל `/api/record` — שמוחק רשומות מהבורד
 * האמיתי — לא בדק תפקיד בכלל. הסיבה הייתה שכל מסלול החליט לבד, ולכן שלושה
 * מסלולים פשוט שכחו. הטסט הזה נועל את הסולם היחיד שמחליף אותם.
 */
import { describe, it, expect } from "vitest";
import { atLeast, isRole, ROLES } from "../roles";

describe("atLeast — צופה < חבר < מנהל", () => {
  it("כל תפקיד מספיק לעצמו", () => {
    for (const r of ROLES) expect(atLeast(r, r)).toBe(true);
  });

  it("תפקיד גבוה מספיק לדרישה נמוכה", () => {
    expect(atLeast("admin", "member")).toBe(true);
    expect(atLeast("admin", "viewer")).toBe(true);
    expect(atLeast("member", "viewer")).toBe(true);
  });

  it("תפקיד נמוך לא מספיק לדרישה גבוהה — זה כל הבאג שנסגר כאן", () => {
    expect(atLeast("viewer", "member")).toBe(false);
    expect(atLeast("viewer", "admin")).toBe(false);
    expect(atLeast("member", "admin")).toBe(false);
  });

  it("נכשל סגור: תפקיד לא מוכר אינו הרשאה, גם לא לדרישה הנמוכה ביותר", () => {
    for (const bad of ["owner", "ADMIN", "", "superuser", "member "]) {
      expect(atLeast(bad, "viewer"), `role=${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it("נכשל סגור: היעדר תפקיד אינו הרשאה", () => {
    expect(atLeast(null, "viewer")).toBe(false);
    expect(atLeast(undefined, "viewer")).toBe(false);
  });
});

describe("isRole — מה מותר לקבל כקלט", () => {
  it("מקבל את שלושת התפקידים בלבד", () => {
    for (const r of ROLES) expect(isRole(r)).toBe(true);
    for (const bad of ["owner", "Admin", 1, null, undefined, {}]) expect(isRole(bad)).toBe(false);
  });
});
