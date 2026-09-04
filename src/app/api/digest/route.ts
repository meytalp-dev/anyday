/**
 * /api/digest — the weekly digest, by email.
 *
 * The promise of the product in its simplest form: the manager opens her inbox
 * on Sunday morning and already knows what needs attention. She does not open
 * anything.
 *
 * ── Where the content comes from ────────────────────────────────────────────
 * Nothing is computed here. Items are read through `fetchBoards()` (the one
 * paginated reader), and every number/name/label is produced by
 * `board-intelligence.ts` — `terminology`, `headlineKpis`, `attention`,
 * `breakdown`, `byOwner`, `numberSummary`. In particular, "needs attention" is
 * whatever the engine says it is: it derives the meaning of a status from the
 * HUE of the colour the board itself gave that label (`toneOf`/`statusTones`),
 * so this route contains no word comparison, no Hebrew status list, and no
 * assumption about what the organisation does. A construction company and a
 * youth charity get a correct email from the same code.
 *
 * ── Honesty about partial reads ─────────────────────────────────────────────
 * A board bigger than ANYDAY_MAX_ITEMS is read only in part. `coverage()` says
 * so, and the email prints "מבוסס על X מתוך Y רשומות" at the top and per board.
 * A percentage of a sample presented as a percentage of the whole is a lie, and
 * a lie in an email nobody double-checks is worse than a lie on a screen.
 *
 * ── Who may call it ─────────────────────────────────────────────────────────
 * This route SENDS MAIL, so a public address would be a flooding tool. Two
 * gates, both must pass:
 *   1. `requireMonday()` — same gate as every other Monday-touching route.
 *   2. A caller from outside the browser must present `CRON_SECRET` (what
 *      Vercel Cron sends) or `DIGEST_SECRET` (a hand-made call) in a header
 *      (`x-digest-secret`, or `Authorization: Bearer <secret>`).
 *      Never in the query string — query strings land in server logs.
 *      A call that already carries this app's own session cookie is "inside"
 *      and does not need the secret.
 *
 * ── Two callers, two different paths ────────────────────────────────────────
 * FROM A BROWSER: the session identifies one org, boards come from the
 * `anyday_selected_boards` cookie — and the answer is a PREVIEW ONLY, never a
 * send. A GET that both sends mail and is authorised by a cookie is a CSRF
 * link: "click here" and the victim's own session mails their board data to
 * whatever address sat in `?to=`. So the browser path no longer accepts
 * recipients at all (there is no `to` parameter left to abuse), and real
 * sending is reserved for the secret-bearing schedule, whose recipients come
 * from each org's own settings in the database.
 *
 * FROM A SCHEDULE (secret, no cookie): `runScheduled()`. There is no session to
 * resolve an org from, so it reads the opted-in orgs out of the database and
 * runs each on its own token, boards and recipients.
 *
 * That second path did not exist before, and its absence was invisible: the
 * secret gate passed, and the request then died inside `requireMonday()` with
 * "יש להתחבר כדי להמשיך". Storing the token was necessary but not sufficient —
 * something still had to read it ON BEHALF OF a named org, and nothing did.
 * Board choice had the same hole: it lived only in a browser cookie.
 * See supabase-schema-v4.sql and /api/digest/settings.
 *
 * Params (query on GET, JSON body on POST):
 *   boards=123,456        board ids       (default: the cookie) — browser path
 *   preview=1 / dry=1     on the schedule: report what WOULD be sent, send none
 *   preview=1             build it and return the parts as JSON, send nothing
 *   preview=html          build it and return the EMAIL ITSELF, send nothing
 * A browser call without preview is refused — see "Two callers" above.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash, timingSafeEqual } from "crypto";
import { requireMonday } from "@/lib/monday-server";
import { fetchBoards, parseBoardIds, coverage, type FetchedBoard } from "@/lib/board-fetch";
import { renderDigest, digestSection } from "@/lib/digest-email";
import { sendEmail } from "@/lib/send-email";
import { getDigestTargets, recordDigestRun, getOrgBranding } from "@/lib/session";
import { rateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { digestSheetBoards } from "@/lib/sheet-source-store";
import type { DigestSource } from "@/lib/digest-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------- gate */

/** Constant-time compare that tolerates different lengths (hash first). */
function secretMatches(presented: string, configured: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(configured).digest();
  return timingSafeEqual(a, b);
}

/**
 * The secrets this route accepts. Either one alone is enough.
 *
 * `CRON_SECRET` is listed because it is the name the PLATFORM sends, not one
 * this file chose: a `crons` entry in vercel.json is invoked as
 * `Authorization: Bearer $CRON_SECRET`. This route used to compare against
 * `DIGEST_SECRET` only, so a correctly configured deployment answered 401 every
 * Sunday morning and told nobody — the schedule looked wired and sent no mail.
 * A digest that silently stops is the exact failure this feature exists to end.
 *
 * `DIGEST_SECRET` stays accepted so a hand-made call — curl, a preview run —
 * keeps working with the name it has always had.
 *
 * They do NOT have to hold the same value, and that is the point: requiring
 * them to match is a rule someone has to remember, and the two would drift.
 */
function configuredSecrets(): string[] {
  return [process.env.CRON_SECRET, process.env.DIGEST_SECRET]
    .map((s) => (s || "").trim())
    .filter((s) => s.length > 0);
}

/** The secret is accepted from headers only — a query string is logged. */
function presentedSecret(req: NextRequest): string | null {
  const direct = req.headers.get("x-digest-secret");
  if (direct?.trim()) return direct.trim();
  const auth = req.headers.get("authorization") || "";
  if (/^bearer\s+/i.test(auth)) {
    const v = auth.replace(/^bearer\s+/i, "").trim();
    if (v) return v;
  }
  return null;
}

type Gate =
  | { ok: true; viaSecret: boolean; hasSession: boolean }
  | { ok: false; status: number; error: string };

/** Does this request carry a browser session at all? */
async function hasBrowserSession(): Promise<boolean> {
  try {
    const jar = await cookies();
    return jar.getAll().some((c) => c.name === "anyday_monday_token" || c.name.startsWith("sb-"));
  } catch {
    return false;
  }
}

async function authorizeDigest(req: NextRequest): Promise<Gate> {
  const configured = configuredSecrets();
  const presented = presentedSecret(req);
  const session = await hasBrowserSession();

  if (presented) {
    // Fail closed: an unset secret must not mean "everything is allowed".
    if (configured.length === 0)
      return { ok: false, status: 503, error: "CRON_SECRET / DIGEST_SECRET לא הוגדרו בשרת, ולכן קריאות חיצוניות חסומות" };
    if (!configured.some((c) => secretMatches(presented, c)))
      return { ok: false, status: 401, error: "סוד שגוי" };
    return { ok: true, viaSecret: true, hasSession: session };
  }

  // No secret presented → this must be a call from a signed-in browser.
  if (session) return { ok: true, viaSecret: false, hasSession: true };

  return {
    ok: false,
    status: 401,
    error: "קריאה חיצונית חייבת לכלול את הכותרת x-digest-secret",
  };
}

/* ---------------------------------------------------------------- content */

interface Params { boards: string | null; preview: boolean; previewHtml?: boolean }

/* ------------------------------------------------------------------- send */

/**
 * Sending goes through `sendEmail()` from `@/lib/send-email`, called DIRECTLY.
 * Resend stays integrated in exactly one place and there is one API key.
 *
 * It used to be an HTTP call to a public `/api/send-email` route. That hop is
 * what kept the route open to the public (reports/B6.md): a server-to-server
 * fetch carries no cookie, so the login gate could not tell the digest apart
 * from an attacker. The route has since been removed entirely — this function
 * call is now the only way the digest produces mail, and there is no network
 * address that accepts recipients from a browser.
 */
async function sendDigest(to: string[], subject: string, html: string) {
  const from = (process.env.DIGEST_FROM || "").trim();

  const result = await sendEmail({ to, subject, html, from: from || undefined });
  if (!result.ok) throw new Error(result.error);
  return result.id || null;
}

/* ----------------------------------------------------------------- handler */

/**
 * The scheduled run — the path a cron job takes, and the one that did not
 * exist until now.
 *
 * A browser call resolves ONE org from the session cookie. A cron call has no
 * cookie, so it goes the other way: it asks the database which organizations
 * opted in, and handles each on its own token and its own boards. That is why
 * `requireMonday()` is not used here — there is no user to be.
 *
 * One organization failing must not stop the rest, so every org is wrapped and
 * its outcome recorded on its own row. The answer always names what was
 * skipped and why: a scheduled job that quietly does nothing is the worst
 * possible failure, because nobody finds out for a week.
 */
async function runScheduled(params: Params) {
  const { targets, skipped } = await getDigestTargets();

  const sent: { org: string; to: string[]; subject: string; id: string | null }[] = [];
  const failed: { org: string; error: string }[] = [];

  for (const t of targets) {
    try {
      // Two kinds of source in one email. Monday boards are read live; saved
      // spreadsheets are read from storage, and a LINKED one is refreshed
      // first — that refresh is the automation (הכרעת מיטל 4.9).
      const boards = t.boardIds.length ? await fetchBoards(t.boardIds, t.token) : [];
      const sheets = await digestSheetBoards(t.orgId, t.sheetSourceIds);

      if (!boards.length && !sheets.length) {
        const why = t.boardIds.length
          ? "הבורדים שנבחרו לא נמצאו או שאין אליהם הרשאה"
          : "הגיליונות השמורים לא נקראו";
        failed.push({ org: t.orgName, error: why });
        await recordDigestRun(t.orgId, why);
        continue;
      }

      // A stored sheet is whole by construction — nothing was paginated away,
      // so it must never claim to be a sample.
      const sheetSections: DigestSource[] = sheets.map((s) => ({
        ...s.board,
        name: s.stale ? `${s.title} (לא רוענן — מוצג המצב מ-${s.fetchedAt.slice(0, 10)})` : s.title,
        itemsCount: s.board.items.length,
        loaded: s.board.items.length,
        truncated: false,
      }));

      // Coverage spans BOTH sources, so "מבוסס על X מתוך Y" describes the whole
      // email. Sheets contribute their full row count and never truncation.
      const sections: DigestSource[] = [...boards, ...sheetSections];
      const cov = coverage(sections);
      const branding = await getOrgBranding(t.orgId);
      const digest = renderDigest({
        boards: sections.map(digestSection),
        coverage: cov,
        generatedAt: new Date(),
        sourceLabel: [...boards.map((b) => b.name), ...sheets.map((s) => s.title)]
          .map((n) => `"${n}"`).join(" · "),
        branding,
      });

      // A dry run reports exactly what it WOULD do, and sends nothing. This is
      // how you inspect a schedule without mailing real people to find out.
      if (params.preview || params.previewHtml) {
        sent.push({ org: t.orgName, to: t.recipients, subject: digest.subject, id: null });
        continue;
      }

      const id = await sendDigest(t.recipients, digest.subject, digest.html);
      sent.push({ org: t.orgName, to: t.recipients, subject: digest.subject, id });
      await recordDigestRun(t.orgId, null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "שגיאה";
      failed.push({ org: t.orgName, error: msg });
      await recordDigestRun(t.orgId, msg);
    }
  }

  return NextResponse.json({
    scheduled: true,
    dryRun: params.preview || params.previewHtml || false,
    organizations: targets.length + skipped.length,
    sent,
    failed,
    skipped,
  });
}

async function handle(req: NextRequest, params: Params) {
  const gate = await authorizeDigest(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  // Authorised by the secret, with no browser behind it → this is the schedule.
  if (gate.viaSecret && !gate.hasSession) return runScheduled(params);

  const guard = await requireMonday();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  // תצוגה מקדימה = קריאת בורדים מלאה. תקרה פר ארגון; מסלול הקרון לא נוגע בזה.
  const rl = rateLimit("digest-preview", guard.orgId, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  // A cookie-authorised call may LOOK but never SEND: a sending GET behind
  // cookie auth is a one-click CSRF that mails board data to an attacker.
  // Real sends run only on the secret-bearing schedule path above, with
  // recipients from each org's own settings — never from this request.
  if (!params.preview && !params.previewHtml)
    return NextResponse.json(
      {
        error:
          "קריאה מהדפדפן מוגבלת לתצוגה מקדימה. הוסיפו ?preview=1 או ?preview=html. שליחה אמיתית רצה מהתזמון, לנמענים שבהגדרות הדיגסט.",
      },
      { status: 403 }
    );

  const saved = (await cookies()).get("anyday_selected_boards")?.value;
  const ids = parseBoardIds(params.boards || saved);
  if (!ids.length)
    return NextResponse.json(
      { error: "לא נבחר בורד. הוסיפו ?boards=<id> או בחרו בורד בדשבורד." },
      { status: 400 }
    );

  let boards: FetchedBoard[];
  try {
    boards = await fetchBoards(ids, guard.token);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאה בקריאת הבורד" }, { status: 502 });
  }
  if (!boards.length)
    return NextResponse.json({ error: "הבורד לא נמצא או שאין הרשאה אליו" }, { status: 404 });

  const cov = coverage(boards);
  // The preview must look like the real send, branding included ("personal"
  // mode has no org row and getOrgBranding returns empties on its own).
  const branding = await getOrgBranding(guard.orgId);
  const digest = renderDigest({
    boards: boards.map(digestSection),
    coverage: cov,
    generatedAt: new Date(),
    sourceLabel: boards.map((b) => `"${b.name}"`).join(" · "),
    branding,
  });

  // `preview=html` renders the email itself, so a person can JUDGE it. The
  // JSON form below stays as it was for anything reading the parts.
  if (params.previewHtml) {
    return new NextResponse(digest.html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Recipients are deliberately absent here: a preview reports content, and
  // who receives the real thing is the schedule's business (digest settings).
  return NextResponse.json({
    preview: true,
    subject: digest.subject,
    text: digest.text,
    html: digest.html,
    coverage: cov,
  });
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  return handle(req, {
    boards: q.get("boards"),
    preview: q.get("preview") === "1" || q.get("dry") === "1",
    previewHtml: q.get("preview") === "html",
  });
}

export async function POST(req: NextRequest) {
  let body: { boards?: string; preview?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const q = req.nextUrl.searchParams;
  return handle(req, {
    boards: body.boards || q.get("boards"),
    preview: body.preview === true || q.get("preview") === "1",
    previewHtml: q.get("preview") === "html",
  });
}
