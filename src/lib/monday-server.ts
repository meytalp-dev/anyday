// Server-side Monday API access. The token is resolved from the logged-in
// user's org (via getMondayToken) — it is never accepted from the client.
import { cookies } from "next/headers";
import { getOrgContext, getMondayToken } from "./session";
import { atLeast, forbiddenMessage, type Role } from "./roles";

const MONDAY_API = "https://api.monday.com/v2";

/**
 * A failed Monday HTTP call, carrying the HTTP status as DATA.
 *
 * Why a class and not just an Error: callers need to tell "Monday rejected the
 * credentials" apart from "Monday is down", and the only trustworthy signal for
 * that is the HTTP status code. Parsing the status back out of the message text
 * would be a hidden word-list (RULES §1) and would break the moment the message
 * is reworded or translated.
 *
 * The `message` is intentionally unchanged from what this function threw
 * before, so every existing caller keeps behaving exactly as it did.
 */
export class MondayApiError extends Error {
  /** structural brand — survives duplicate module instances, unlike instanceof */
  readonly isMondayApiError = true;
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "MondayApiError";
    this.status = status;
  }
}

/**
 * Did Monday itself reject the credentials?
 *
 * Decided purely by the HTTP status Monday returned (401 = Not Authenticated),
 * never by looking for words inside the error message. Anything else — 5xx, a
 * network failure, a GraphQL-level error — is NOT an auth failure and must keep
 * surfacing as a real error, so a user whose Monday is merely down is never
 * told to reconnect a perfectly good connection.
 */
export function isMondayAuthFailure(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { isMondayApiError?: unknown }).isMondayApiError === true &&
    (e as { status?: unknown }).status === 401
  );
}

/** The one wording for "the Monday connection is no longer valid" (see requireMonday). */
export const MONDAY_REAUTH_MESSAGE = "החיבור ל-Monday פג. חברו מחדש.";

/**
 * Run a Monday GraphQL request.
 *
 * ALWAYS pass user-supplied data through `variables` rather than interpolating
 * it into the query string: a name/status/id containing a quote can otherwise
 * rewrite the query itself (and this token has write + delete rights).
 *
 * On an HTTP failure it throws a {@link MondayApiError} — still an Error with
 * the same message as before, plus the status code for callers that care.
 */
export async function mondayQuery(
  query: string,
  token: string,
  variables?: Record<string, unknown>
) {
  const res = await fetch(MONDAY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
      "API-Version": "2024-01",
    },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  if (!res.ok) throw new MondayApiError(res.status, `Monday API error (${res.status})`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

export type MondayGuardResult =
  | { ok: true; token: string; orgId: string; role: Role }
  | { ok: false; status: number; error: string };

/**
 * Is the single-operator personal-token shortcut allowed to run right now?
 *
 * That shortcut hands the SAME Monday account to every visitor, with no login
 * — fine on a laptop, catastrophic on a public URL. So it is enabled only in
 * development, unless the operator has deliberately opted in with
 * ANYDAY_ALLOW_PERSONAL_TOKEN=true (documented as single-tenant only).
 *
 * Exported because it gates BOTH single-operator paths: the env token below
 * and the paste-a-token cookie flow (/api/connect sets it, requireMonday reads
 * it). Gating only one of them left the more dangerous one — the cookie, which
 * any visitor can mint for themselves — as the only ungated door.
 */
export function personalTokenAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.ANYDAY_ALLOW_PERSONAL_TOKEN === "true";
}

let warnedAboutPersonalToken = false;

/**
 * The gate every Monday-touching route calls first:
 *  - requires an authenticated user with an org (401),
 *  - requires that org to have a connected Monday token (409).
 * On success returns the decrypted token to use for this request only.
 */
export async function requireMonday(): Promise<MondayGuardResult> {
  // ── SINGLE-OPERATOR MODE (dev only, see personalTokenAllowed) ──
  // Lets one person experiment against their own real Monday account without
  // setting up Supabase auth + OAuth.
  const personal = process.env.MONDAY_PERSONAL_TOKEN;
  if (personal && personal.trim().length > 20) {
    if (personalTokenAllowed()) {
      return { ok: true, token: personal.trim(), orgId: "personal", role: "admin" };
    }
    if (!warnedAboutPersonalToken) {
      warnedAboutPersonalToken = true;
      console.warn(
        "[AnyDay] MONDAY_PERSONAL_TOKEN is set in production and was IGNORED. " +
          "It would give every anonymous visitor full read/write access to that " +
          "Monday account. Set ANYDAY_ALLOW_PERSONAL_TOKEN=true only for a " +
          "private single-tenant deployment."
      );
    }
    // fall through to the real, per-user paths below
  }

  // Cookie token set by the /welcome → /connect flow (each visitor pastes their
  // OWN token; it is httpOnly + sameSite so it stays scoped to that browser).
  // Honored ONLY where the single-operator mode is allowed: the value is never
  // verified here, so in a public deployment any self-minted cookie longer
  // than 20 characters would walk straight through this gate.
  if (personalTokenAllowed()) {
    try {
      const cookieToken = (await cookies()).get("anyday_monday_token")?.value;
      if (cookieToken && cookieToken.length > 20) {
        return { ok: true, token: cookieToken, orgId: "personal", role: "admin" };
      }
    } catch { /* cookies() unavailable in some contexts — fall through */ }
  }

  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, status: 401, error: "יש להתחבר כדי להמשיך" };
  if (!ctx.mondayConnected)
    return { ok: false, status: 409, error: "Monday לא מחובר. חברו את החשבון תחילה." };
  const token = await getMondayToken(ctx.orgId);
  if (!token)
    return { ok: false, status: 409, error: MONDAY_REAUTH_MESSAGE };
  return { ok: true, token, orgId: ctx.orgId, role: (ctx.role as Role) ?? "viewer" };
}

/**
 * `requireMonday`, plus "and you must be at least this role".
 *
 * The routes that write to the customer's real board call THIS. Three of them
 * used to call the plain guard and never look at the role, which is how a
 * viewer came to be able to delete records — the permission existed and simply
 * was not asked about.
 */
export async function requireRole(min: Role): Promise<MondayGuardResult> {
  const guard = await requireMonday();
  if (!guard.ok) return guard;
  if (!atLeast(guard.role, min)) {
    return { ok: false, status: 403, error: forbiddenMessage(min) };
  }
  return guard;
}
