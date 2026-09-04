import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
// The SSRF rule lives in one place, because a saved sheet source re-reads the
// same link on a schedule and a second copy is a second place to be wrong.
import { csvUrlFor, SHARE_HINT } from "@/lib/sheets-url";

/**
 * POST /api/sheets — fetch a shared Google Sheet as CSV, for /sheet.
 *
 * Why a server route at all: Google's CSV export sends no CORS headers, so the
 * browser cannot read it directly. This route is a narrow pipe and nothing
 * more: the bytes go straight back to the tab that asked — nothing is stored,
 * logged or parsed here. Parsing happens in the browser, by the SAME reader a
 * dropped file gets (sheet-to-board), so there is exactly one place that
 * understands a spreadsheet.
 *
 * The SSRF rule (parse the pasted link, never fetch it) lives in lib/sheets-url.
 */

const MAX_BYTES = 20 * 1024 * 1024; // the same cap the file path enforces

/** The sheet's own name, when Google says it (content-disposition filename). */
function titleFrom(res: Response): string | null {
  const cd = res.headers.get("content-disposition") || "";
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) { try { const t = decodeURIComponent(star[1]).replace(/\.csv$/i, "").trim(); if (t) return t; } catch { /* fall back to the plain form */ } }
  const plain = cd.match(/filename="([^"]+)"/i);
  if (plain) { const t = plain[1].replace(/\.csv$/i, "").trim(); if (t) return t; }
  return null;
}

export async function POST(req: NextRequest) {
  // הנתיב ציבורי במכוון (מסלול /sheet עובד בלי חשבון), ולכן התקרה לפי IP:
  // בלעדיה הוא צינור חינמי להורדת CSV-ים מגוגל דרך השרת שלנו.
  const rl = rateLimit("sheets", clientIp(req), 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  const { url } = await req.json().catch(() => ({}));
  if (!url || typeof url !== "string" || url.length > 2000) {
    return NextResponse.json({ error: "חסר קישור לגיליון." }, { status: 400 });
  }
  const target = csvUrlFor(url.trim());
  if ("bad" in target) return NextResponse.json({ error: target.bad }, { status: 400 });

  let res: Response;
  try {
    res = await fetch(target.url, { redirect: "follow", signal: AbortSignal.timeout(15000), cache: "no-store" });
  } catch {
    return NextResponse.json({ error: "Google לא ענה בזמן. נסו שוב עוד רגע." }, { status: 502 });
  }

  // A private sheet does not FAIL — Google redirects to a login page and
  // answers 200. So the tell is the content type, not the status.
  const type = res.headers.get("content-type") || "";
  if (!res.ok || type.includes("text/html")) {
    return NextResponse.json({ error: `לא קיבלתי גישה לגיליון. ${SHARE_HINT}` }, { status: 400 });
  }
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) return NextResponse.json({ error: "הגיליון גדול מ-20MB." }, { status: 400 });
  const csv = await res.text();
  if (csv.length > MAX_BYTES) return NextResponse.json({ error: "הגיליון גדול מ-20MB." }, { status: 400 });
  if (csv.trim().startsWith("<")) {
    return NextResponse.json({ error: `לא קיבלתי גישה לגיליון. ${SHARE_HINT}` }, { status: 400 });
  }
  return NextResponse.json({ csv, title: titleFrom(res) });
}
