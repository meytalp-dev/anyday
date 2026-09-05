/**
 * ההזמנה — הלוגיקה הטהורה.
 *
 * Everything here is a pure function over values, so the rules that decide who
 * gets into an organisation can be tested directly instead of through a
 * database. The route beside it does the I/O and nothing else.
 *
 * THE ONE RULE WORTH SAYING OUT LOUD
 * A row in this table never proves anything on its own. It holds the HASH of
 * the token, and the token exists only inside the link that was sent. Someone
 * who reads the table — a leaked backup, a mis-scoped query — learns who was
 * invited and cannot become any of them. This is the same reasoning that keeps
 * the Monday token encrypted one table over, applied to a smaller secret.
 */

import { createHash, randomBytes } from "crypto";
import { isRole, type Role } from "./roles";

/** How long a link stays good. Long enough to survive a holiday, short enough
 *  that a forwarded email from last spring opens nothing. */
export const INVITE_TTL_DAYS = 14;

/** 32 random bytes, base64url — long enough that guessing is not a strategy. */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What gets stored. Never store the token itself. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Addresses are compared case-insensitively and without surrounding space,
 *  because that is how people type them and how mail servers treat them. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  // Deliberately permissive: the real proof of an address is that a person
  // opened the link sent to it. This only rejects what is obviously not one.
  if (e.length < 5 || e.length > 254) return null;
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

export function expiryFrom(now: Date): string {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** The invitation as the database holds it — only the fields a decision needs. */
export interface InviteRow {
  org_id: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
}

export type InviteVerdict =
  | { ok: true; orgId: string; role: Role }
  | { ok: false; reason: "unknown" | "expired" | "used" | "badRole"; message: string };

/**
 * May this row be redeemed right now?
 *
 * Order matters for what the person is told: an invitation that was already
 * used says so, rather than "unknown", because "unknown" reads as "you were
 * never invited" and sends someone back to an admin who did nothing wrong.
 */
export function checkInvite(row: InviteRow | null, now: Date): InviteVerdict {
  if (!row) {
    return { ok: false, reason: "unknown", message: "ההזמנה הזו לא קיימת. בקשו קישור חדש ממנהל הארגון." };
  }
  if (row.accepted_at) {
    return { ok: false, reason: "used", message: "ההזמנה הזו כבר נוצלה. אם זה לא אתם — בקשו קישור חדש." };
  }
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    return { ok: false, reason: "expired", message: `ההזמנה פגה. קישור הזמנה תקף ${INVITE_TTL_DAYS} יום — בקשו חדש.` };
  }
  if (!isRole(row.role)) {
    // A role this version does not know is not a role it may grant.
    return { ok: false, reason: "badRole", message: "ההזמנה פגומה. בקשו קישור חדש ממנהל הארגון." };
  }
  return { ok: true, orgId: row.org_id, role: row.role };
}

/** What an organization must look like for us to replace it on joining. */
export interface SoloOrgFacts {
  memberCount: number;
  mondayConnected: boolean;
  savedThings: number;
}

/**
 * A user belongs to one organization (`getOrgContext` reads `.limit(1)`), so
 * joining one means leaving the one the bootstrap made. That is only safe when
 * there is demonstrably nothing there to lose.
 *
 * "Nothing to lose" is not a guess: they are its only member, no Monday
 * account is connected through it, and nothing has been saved in it. Anything
 * else — a colleague already in it, a connected account, one saved dashboard —
 * and we refuse and say why, rather than quietly deleting someone's work.
 */
export function canReplaceOrg(facts: SoloOrgFacts): boolean {
  return facts.memberCount === 1 && !facts.mondayConnected && facts.savedThings === 0;
}

export const ORG_NOT_EMPTY_MESSAGE =
  "החשבון הזה כבר מנהל ארגון פעיל עם נתונים, וחשבון שייך לארגון אחד. " +
  "כדי להצטרף לארגון אחר, היכנסו עם כתובת דוא״ל אחרת.";

/** The link an admin copies. Built from the request's own origin so it is
 *  right on localhost, on a preview deployment and on the real domain. */
export function inviteLink(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/join?token=${encodeURIComponent(token)}`;
}
