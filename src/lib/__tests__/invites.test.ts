/**
 * ההזמנה — הכללים שמחליטים מי נכנס לארגון.
 *
 * הכל כאן טהור בכוונה: הכללים האלה קובעים גישה לנתונים של ארגון אחר, ולכן הם
 * צריכים להיבדק ישירות ולא דרך בסיס נתונים.
 */
import { describe, it, expect } from "vitest";
import {
  newInviteToken, hashInviteToken, normalizeEmail, expiryFrom,
  checkInvite, canReplaceOrg, inviteLink, INVITE_TTL_DAYS, type InviteRow,
} from "../invites";

const NOW = new Date("2026-09-05T10:00:00Z");
const row = (over: Partial<InviteRow> = {}): InviteRow => ({
  org_id: "org-1", role: "member",
  expires_at: expiryFrom(NOW), accepted_at: null, ...over,
});

describe("הטוקן — מה נשמר ומה לא", () => {
  it("שני טוקנים לעולם לא זהים", () => {
    const seen = new Set(Array.from({ length: 200 }, newInviteToken));
    expect(seen.size).toBe(200);
  });

  it("הטוקן ארוך מספיק שניחוש אינו אסטרטגיה", () => {
    expect(newInviteToken().length).toBeGreaterThanOrEqual(40);
  });

  it("הגיבוב יציב, ואינו מכיל את הטוקן — זו כל ההגנה", () => {
    const t = newInviteToken();
    expect(hashInviteToken(t)).toBe(hashInviteToken(t));
    expect(hashInviteToken(t)).not.toContain(t);
    expect(hashInviteToken(t)).toHaveLength(64);
  });

  it("טוקן אחר = גיבוב אחר", () => {
    expect(hashInviteToken("a")).not.toBe(hashInviteToken("b"));
  });
});

describe("normalizeEmail", () => {
  it("מנרמל רווחים ואותיות גדולות, כדי ששתי כתובות זהות לא ייראו שונות", () => {
    expect(normalizeEmail("  Dana@Amuta.ORG.il ")).toBe("dana@amuta.org.il");
  });

  it("דוחה מה שאינו כתובת", () => {
    for (const bad of ["", "dana", "dana@", "@amuta.org", "dana@amuta", null, 7, undefined]) {
      expect(normalizeEmail(bad), String(bad)).toBeNull();
    }
  });
});

describe("checkInvite — מתי מותר לממש", () => {
  it("הזמנה תקפה נפדית, והתפקיד עובר איתה", () => {
    const v = checkInvite(row({ role: "viewer" }), NOW);
    expect(v).toEqual({ ok: true, orgId: "org-1", role: "viewer" });
  });

  it("הזמנה שכבר נוצלה אומרת בדיוק את זה — לא 'לא קיימת'", () => {
    const v = checkInvite(row({ accepted_at: NOW.toISOString() }), NOW);
    expect(v.ok).toBe(false);
    if (!v.ok) { expect(v.reason).toBe("used"); expect(v.message).toContain("כבר נוצלה"); }
  });

  it("הזמנה שפגה נדחית, וברגע הפקיעה עצמו — לא רק אחריו", () => {
    const expired = row({ expires_at: NOW.toISOString() });
    const v = checkInvite(expired, NOW);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("expired");
  });

  it("תקפה עד רגע לפני הפקיעה", () => {
    const almost = row({ expires_at: new Date(NOW.getTime() + 1000).toISOString() });
    expect(checkInvite(almost, NOW).ok).toBe(true);
  });

  it("טוקן שלא נמצא = לא קיימת", () => {
    const v = checkInvite(null, NOW);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("unknown");
  });

  it("נכשל סגור: תפקיד שהגרסה הזו לא מכירה אינו תפקיד שהיא מעניקה", () => {
    const v = checkInvite(row({ role: "owner" }), NOW);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("badRole");
  });

  it("התוקף הוא 14 יום", () => {
    const days = (new Date(expiryFrom(NOW)).getTime() - NOW.getTime()) / 86400000;
    expect(days).toBe(INVITE_TTL_DAYS);
  });
});

describe("canReplaceOrg — מתי מותר להחליף את הארגון שנוצר אוטומטית", () => {
  it("ארגון ריק לגמרי מוחלף", () => {
    expect(canReplaceOrg({ memberCount: 1, mondayConnected: false, savedThings: 0 })).toBe(true);
  });

  it("לא מוחלף אם יש בו עוד אדם, חשבון מחובר, או משהו שמור", () => {
    expect(canReplaceOrg({ memberCount: 2, mondayConnected: false, savedThings: 0 })).toBe(false);
    expect(canReplaceOrg({ memberCount: 1, mondayConnected: true, savedThings: 0 })).toBe(false);
    expect(canReplaceOrg({ memberCount: 1, mondayConnected: false, savedThings: 1 })).toBe(false);
  });
});

describe("inviteLink", () => {
  it("נבנה מהמקור של הבקשה, ולא משובר בלוכסן כפול", () => {
    expect(inviteLink("https://anyday.co.il/", "abc")).toBe("https://anyday.co.il/join?token=abc");
    expect(inviteLink("http://localhost:3000", "abc")).toBe("http://localhost:3000/join?token=abc");
  });

  it("מקודד טוקן שיש בו תווים בעייתיים ב-URL", () => {
    expect(inviteLink("https://x.co", "a+b/c=")).toBe("https://x.co/join?token=a%2Bb%2Fc%3D");
  });
});
