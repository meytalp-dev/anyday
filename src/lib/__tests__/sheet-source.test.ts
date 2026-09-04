/**
 * מקור-גיליון שמור (הכרעת מיטל 4.9: "תשמור את הנתונים עצמם כדי שיהיה אפשר
 * לעשות אוטומציות").
 *
 * אוטומציה לא צריכה לכתוב לשום מקום — היא צריכה **לקרוא כשאף אחד לא מסתכל**.
 * גיליון שנגרר ללשונית קיים רק שם, ולכן דשבורד שמור ממנו מחייב שהנתונים
 * יישמרו. הקובץ הזה הוא החוזה של מה שנשמר ואיך בונים ממנו `Board` בשרת.
 *
 * מה שנשמר הוא **הטקסט הגולמי + תיקוני-הטיפוס של המשתמשת**, לא שורות מנותחות:
 * כך יש מפענח אחד בלבד למערכת (`readSheet`), ותיקון טיפוס שהמשתמשת עשתה שורד
 * גם משיכה מחדש של קישור, כי מזהי-העמודות הם מיקומיים.
 */
import { describe, it, expect } from "vitest";
import { sanitizeSheetSource, sourceToBoard, MAX_STORED_CSV, type StoredSheetSource } from "../sheet-source";
import { bucketOf } from "../board-profile";

const CSV = [
  "שם מלא,בית ספר,סטטוס טיפול,שנת סיום",
  "דנה,אשקלון,טופל,2024",
  "יוסי,אשקלון,ממתין,2023",
  "רות,קרית מוצקין,טופל,2024",
].join("\n");

const base = { title: "בוגרים", kind: "file" as const, csv: CSV };

describe("sanitizeSheetSource — מה מותר להיכנס לאחסון", () => {
  it("מקור תקין עובר במלואו", () => {
    const s = sanitizeSheetSource(base)!;
    expect(s.title).toBe("בוגרים");
    expect(s.kind).toBe("file");
    expect(s.csv).toBe(CSV);
  });

  it("בלי תוכן — נדחה, לא נשמר מקור ריק", () => {
    expect(sanitizeSheetSource({ ...base, csv: "" })).toBeNull();
    expect(sanitizeSheetSource({ ...base, csv: "   \n  " })).toBeNull();
  });

  it("סוג מקור זר נדחה — רק קובץ או קישור", () => {
    expect(sanitizeSheetSource({ ...base, kind: "ftp" })).toBeNull();
  });

  it("קישור נשמר רק כשהוא של Google Sheets — SSRF לא נכנס לאחסון", () => {
    expect(sanitizeSheetSource({ ...base, kind: "link", url: "http://169.254.169.254/latest/meta-data" })).toBeNull();
    expect(sanitizeSheetSource({ ...base, kind: "link", url: "https://evil.example.com/x" })).toBeNull();
    const ok = sanitizeSheetSource({ ...base, kind: "link", url: "https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0" });
    expect(ok?.url).toContain("docs.google.com");
  });

  it("קישור בלי כתובת נדחה — 'קישור' בלי קישור אינו מקור", () => {
    expect(sanitizeSheetSource({ ...base, kind: "link" })).toBeNull();
  });

  it("קובץ מתעלם מכתובת שנשלחה בטעות", () => {
    const s = sanitizeSheetSource({ ...base, kind: "file", url: "https://docs.google.com/spreadsheets/d/A/edit" })!;
    expect(s.url).toBeUndefined();
  });

  it("גיליון גדול מהתקרה נדחה — האחסון אינו דיסק", () => {
    const huge = "a,b\n" + "1,2\n".repeat(MAX_STORED_CSV);
    expect(huge.length).toBeGreaterThan(MAX_STORED_CSV);
    expect(sanitizeSheetSource({ ...base, csv: huge })).toBeNull();
  });

  it("כותרת חסרה מקבלת ברירת מחדל, וכותרת ענקית נחתכת", () => {
    expect(sanitizeSheetSource({ ...base, title: "" })!.title).toBeTruthy();
    expect(sanitizeSheetSource({ ...base, title: "x".repeat(500) })!.title.length).toBeLessThanOrEqual(120);
  });

  it("תיקוני טיפוס נשמרים, וטיפוס לא מוכר נזרק", () => {
    const s = sanitizeSheetSource({ ...base, typeOverrides: { c3: "numbers", c9: "rocket" } })!;
    expect(s.typeOverrides).toEqual({ c3: "numbers" });
  });

  it("שדה זר לא שורד — המסמך נקרא בשרת ואסור שיהיה מקום להבריח בו דבר", () => {
    const s = sanitizeSheetSource({ ...base, evil: "<script>", orgId: "other-org" }) as unknown as Record<string, unknown>;
    expect(s.evil).toBeUndefined();
    expect(s.orgId).toBeUndefined();
  });
});

describe("sourceToBoard — מהאחסון חזרה ללוח", () => {
  const src = (over?: Partial<StoredSheetSource>): StoredSheetSource =>
    ({ ...sanitizeSheetSource(base)!, ...over });

  it("נבנה לוח עם השורות והעמודות של הגיליון", () => {
    const b = sourceToBoard(src())!;
    expect(b.items).toHaveLength(3);
    expect(b.columns.map((c) => c.title)).toContain("בית ספר");
  });

  it("שם הלוח הוא הכותרת שנשמרה", () => {
    expect(sourceToBoard(src({ title: "מאגר הבוגרים" }))!.name).toBe("מאגר הבוגרים");
  });

  it("תיקון טיפוס ששמרה המשתמשת מנצח את הניחוש", () => {
    const guessed = sourceToBoard(src())!;
    const yearCol = guessed.columns.find((c) => c.title === "שנת סיום")!;
    const fixed = sourceToBoard(src({ typeOverrides: { [yearCol.id]: "text" } }))!;
    expect(bucketOf(fixed.columns.find((c) => c.title === "שנת סיום")!.type)).toBe("text");
  });

  it("גיליון ריק מחזיר null ולא לוח מדומה", () => {
    const s = { ...src(), csv: "\n\n" } as StoredSheetSource;
    expect(sourceToBoard(s)).toBeNull();
  });

  it("אותו מקור מייצר את אותו לוח בדיוק — אוטומציה שרצה שוב לא מקבלת מספרים אחרים", () => {
    const a = sourceToBoard(src())!;
    const b = sourceToBoard(src())!;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
