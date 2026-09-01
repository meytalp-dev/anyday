/**
 * מיתוג פר-ארגון במייל הדיגסט (W1-2 בלוח ה-BI): לוגו + צבע-מותג + שם הארגון
 * בכותרת. הכלל: בלי מיתוג — המייל נשאר בדיוק כפי שהיה; מיתוג לא-תקין
 * (צבע שאינו hex, שם עם תגיות) לעולם לא הופך ל-markup.
 */
import { describe, it, expect } from "vitest";
import { renderDigest } from "../digest-email";
import type { DigestInput } from "../digest-email";

const base = (branding?: DigestInput["branding"]): DigestInput => ({
  boards: [],
  coverage: { loaded: 0, total: 0, truncated: false, note: "" },
  generatedAt: new Date("2026-09-01T08:00:00Z"),
  sourceLabel: "",
  ...(branding ? { branding } : {}),
});

describe("renderDigest — מיתוג ארגוני", () => {
  it("בלי מיתוג: כותרת AnyDay על הרקע הסגול, כמו תמיד", () => {
    const { html } = renderDigest(base());
    expect(html).toContain("AnyDay");
    expect(html).toContain("#5B2BD9");
    expect(html).not.toContain("<img");
  });

  it("עם לוגו: תג img עם הכתובת, ושם הארגון כטקסט חלופי", () => {
    const { html } = renderDigest(
      base({ orgName: "עמותת הופה", logoUrl: "https://cdn.example.org/logos/org1.png" })
    );
    expect(html).toContain('src="https://cdn.example.org/logos/org1.png"');
    expect(html).toContain('alt="עמותת הופה"');
  });

  it("שם ארגון מופיע בכותרת במקום AnyDay הגנרי", () => {
    const { html } = renderDigest(base({ orgName: "עמותת הופה" }));
    expect(html).toContain("עמותת הופה");
  });

  it("צבע-מותג תקין מחליף את סגול ברירת-המחדל ברקע הכותרת", () => {
    const { html } = renderDigest(base({ brandColor: "#0B8F76" }));
    expect(html).toContain("background:#0B8F76");
    expect(html).not.toContain("background:#5B2BD9");
  });

  it("צבע-מותג שאינו hex לא מוזרק — נשארים על ברירת המחדל", () => {
    const { html } = renderDigest(base({ brandColor: 'red;"><script>' }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("#5B2BD9");
  });

  it("שם ארגון עם תגיות מבורח, לא הופך ל-markup", () => {
    const { html } = renderDigest(base({ orgName: '<img src=x onerror=1>' }));
    expect(html).not.toContain("<img src=x");
  });

  it("כתובת לוגו שאינה https לא הופכת לתג img", () => {
    const { html } = renderDigest(
      base({ orgName: "ארגון", logoUrl: 'javascript:alert(1)' })
    );
    expect(html).not.toContain("<img");
  });
});
