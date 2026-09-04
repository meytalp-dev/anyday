/**
 * השער של מסלול הטוקן האישי — ומי מותר לו להציע אותו על המסך.
 *
 * המסלול הזה מוסר את אותו חשבון Monday לכל מי שמגיע לכתובת, בלי התחברות.
 * על מחשב אחד זה קיצור דרך; על URL ציבורי זו פרצה. לכן `/api/connect` חוסם
 * אותו בפרודקשן ומחזיר 403.
 *
 * אבל השרת שחוסם והמסך שמציע היו שני מקורות אמת נפרדים: המסך המשיך להציע
 * "יש לכם טוקן אישי? התחברו כאן", המשתמש הדביק, וקיבל שגיאה. זה בדיוק הכשל
 * שכבר הוכרע כאן פעם אחת עבור כפתור Google (`auth-providers.ts`): להסתיר
 * כפתור עובד עולה למבקר קליק אחד, להציג כפתור מת עולה באמון שלו במוצר.
 *
 * לכן `personalTokenAllowed()` הוא מקור אמת אחד לשניהם, והטסט הזה נועל אותו.
 */
import { describe, it, expect, afterEach } from "vitest";
import { personalTokenAllowed } from "../monday-server";

const ENV = process.env.NODE_ENV;
const FLAG = process.env.ANYDAY_ALLOW_PERSONAL_TOKEN;

/** NODE_ENV is readonly in the Node types; the test needs to set it anyway. */
function setEnv(nodeEnv: string | undefined, flag: string | undefined) {
  (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
  (process.env as Record<string, string | undefined>).ANYDAY_ALLOW_PERSONAL_TOKEN = flag;
}

afterEach(() => setEnv(ENV, FLAG));

describe("personalTokenAllowed — שער אחד לשרת ולמסך", () => {
  it("פתוח בפיתוח, בלי שצריך לזכור להדליק דגל", () => {
    setEnv("development", undefined);
    expect(personalTokenAllowed()).toBe(true);
  });

  it("סגור בפרודקשן כברירת מחדל — שם המסלול מסוכן", () => {
    setEnv("production", undefined);
    expect(personalTokenAllowed()).toBe(false);
  });

  it("נפתח בפרודקשן רק בהצהרה מפורשת של המפעיל", () => {
    setEnv("production", "true");
    expect(personalTokenAllowed()).toBe(true);
  });

  it("נכשל סגור: כל ערך שאינו המחרוזת true אינו הסכמה", () => {
    for (const v of ["1", "yes", "TRUE", "", "false"]) {
      setEnv("production", v);
      expect(personalTokenAllowed(), `flag=${JSON.stringify(v)}`).toBe(false);
    }
  });
});
