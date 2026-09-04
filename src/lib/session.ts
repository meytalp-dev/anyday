// Server-only module: relies on next/headers cookies via createServerSupabase.
import { createServerSupabase, createServiceClient } from "./supabase-server";
import { decrypt } from "./encryption";

export interface OrgContext {
  userId: string;
  email: string | null;
  orgId: string;
  orgName: string;
  role: string;
  mondayConnected: boolean;
  mondayAccountName: string | null;
}

/**
 * The org slug is derived from the user id and nothing else, so it is the SAME
 * on every concurrent first request. That is what makes the bootstrap below
 * safe: two parallel requests produce the same slug, the unique index on
 * organizations.slug lets only one row exist, and the loser simply reads it.
 *
 * A time-based slug used to be generated here, which made every racing request
 * unique — and produced two orgs for one user, 121ms apart, on the very first
 * real login.
 */
function orgSlugFor(userId: string): string {
  return `org-${userId}`;
}

/**
 * Resolve the logged-in user and the organization they belong to.
 * On a user's very first authenticated call, this auto-creates an organization
 * and an admin membership for them (the "bootstrap") using the service-role
 * client, so the multi-tenant model is populated without any manual step.
 *
 * Returns null if there is no authenticated user (caller should 401) or if
 * Supabase is not configured (caller should surface a setup message).
 */
export async function getOrgContext(): Promise<OrgContext | null> {
  const supabase = await createServerSupabase();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Find an existing membership (RLS: user sees only their own).
  const { data: membership } = await supabase
    .from("org_users")
    .select("org_id, role, organizations(name, monday_token_encrypted, monday_account_name)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (membership) {
    const org = membership.organizations as unknown as {
      name: string;
      monday_token_encrypted: string | null;
      monday_account_name: string | null;
    };
    return {
      userId: user.id,
      email: user.email ?? null,
      orgId: membership.org_id as string,
      orgName: org?.name ?? "הארגון שלי",
      role: (membership.role as string) ?? "admin",
      mondayConnected: Boolean(org?.monday_token_encrypted),
      mondayAccountName: org?.monday_account_name ?? null,
    };
  }

  // No org yet → bootstrap one with the service client (bypasses RLS).
  const service = createServiceClient();
  if (!service) return null;

  const baseName =
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    "הארגון שלי";
  const orgName = `${baseName} — AnyDay`;

  const slug = orgSlugFor(user.id);

  // Insert only if this user has no org yet. If a parallel request beat us to
  // it, the unique index on slug swallows this write instead of creating a
  // second org — the whole point of the deterministic slug above.
  const { error: orgErr } = await service
    .from("organizations")
    .upsert({ name: orgName, slug, plan: "trial" }, { onConflict: "slug", ignoreDuplicates: true });
  if (orgErr) {
    console.error("Org bootstrap failed:", orgErr.message);
    return null;
  }

  // Read back whichever row exists now — ours, or the one the race winner made.
  const { data: org, error: readErr } = await service
    .from("organizations")
    .select("id, name")
    .eq("slug", slug)
    .single();
  if (readErr || !org) {
    console.error("Org bootstrap read-back failed:", readErr?.message);
    return null;
  }

  // Same reasoning: unique(org_id, user_id) makes the second write a no-op.
  const { error: memErr } = await service.from("org_users").upsert(
    { org_id: org.id, user_id: user.id, role: "admin" },
    { onConflict: "org_id,user_id", ignoreDuplicates: true }
  );
  if (memErr) {
    console.error("Membership bootstrap failed:", memErr.message);
    return null;
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    orgId: org.id as string,
    orgName: org.name as string,
    role: "admin",
    mondayConnected: false,
    mondayAccountName: null,
  };
}

/**
 * Fetch and decrypt the Monday token for the current user's org.
 * Uses the service client to read the encrypted column AFTER getOrgContext has
 * already proven the user belongs to that org. Never returns the token to any
 * client — callers use it only to talk to Monday server-side.
 */
export async function getMondayToken(orgId: string): Promise<string | null> {
  const service = createServiceClient();
  if (!service) return null;
  const { data, error } = await service
    .from("organizations")
    .select("monday_token_encrypted")
    .eq("id", orgId)
    .single();
  if (error || !data?.monday_token_encrypted) return null;
  try {
    return decrypt(data.monday_token_encrypted as string);
  } catch (e) {
    console.error("Monday token decrypt failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/* ---------------------------------------------------------------- branding */

export interface OrgBranding {
  orgName: string | null;
  logoUrl: string | null;
  brandColor: string | null;
}

/**
 * The org's branding (W1): name + logo + brand colour, for the dashboard
 * header and the digest email.
 *
 * Deliberately failure-tolerant: the columns arrive with supabase-schema-v6,
 * and a deployment whose operator has not run v6 yet must degrade to the
 * unbranded product — never break the digest or the dashboard over a logo.
 */
export async function getOrgBranding(orgId: string): Promise<OrgBranding> {
  const none: OrgBranding = { orgName: null, logoUrl: null, brandColor: null };
  if (!orgId || orgId === "personal") return none;
  const service = createServiceClient();
  if (!service) return none;
  const { data, error } = await service
    .from("organizations")
    .select("name, logo_url, brand_color")
    .eq("id", orgId)
    .single();
  if (error || !data) return none;
  return {
    orgName: (data.name as string) ?? null,
    logoUrl: (data.logo_url as string) ?? null,
    brandColor: (data.brand_color as string) ?? null,
  };
}

/* ------------------------------------------------------------------ digest */

/** One organization a scheduled run should email, with everything it needs. */
export interface DigestTarget {
  orgId: string;
  orgName: string;
  /** Already decrypted. Never leaves the server. Empty for a sheet-only org. */
  token: string;
  boardIds: string[];
  /** Saved spreadsheets backing this org's sheet dashboards (הכרעת מיטל 4.9).
   *  An org with these and no Monday still gets a digest. */
  sheetSourceIds: string[];
  recipients: string[];
}

/** The saved spreadsheets an org's sheet dashboards point at. */
async function sheetSourceIdsFor(
  service: NonNullable<ReturnType<typeof createServiceClient>>,
  orgId: string
): Promise<string[]> {
  const { data, error } = await service
    .from("dashboards")
    .select("source_ref")
    .eq("org_id", orgId)
    .eq("source_kind", "sheet");
  // Before v7 the column/table may not answer — that is "no sheets", not a fault.
  if (error) return [];
  return [...new Set((data ?? []).map((d) => String(d.source_ref)).filter(Boolean))];
}

/**
 * Mirror the dashboard's board choice onto the org row.
 *
 * The browser keeps its own httpOnly cookie and that stays the source of truth
 * for the screen. This copy exists for the one caller that has no browser: a
 * scheduled run. Failure is deliberately non-fatal — a person picking boards
 * must not see an error because a background feature could not be recorded.
 */
export async function saveDigestBoards(orgId: string, boardIds: string[]): Promise<void> {
  const service = createServiceClient();
  if (!service) return;
  const { error } = await service
    .from("organizations")
    .update({ digest_board_ids: boardIds })
    .eq("id", orgId);
  if (error) console.warn("Could not mirror board selection for the digest:", error.message);
}

/** Record the outcome of a scheduled send, so a silent stop is still visible. */
export async function recordDigestRun(orgId: string, error: string | null): Promise<void> {
  const service = createServiceClient();
  if (!service) return;
  await service
    .from("organizations")
    .update(
      error
        ? { digest_last_error: error.slice(0, 500) }
        : { digest_last_sent_at: new Date().toISOString(), digest_last_error: null }
    )
    .eq("id", orgId);
}

/**
 * Every organization a scheduled digest should run for.
 *
 * This is the piece that made cron possible. `getOrgContext()` resolves an org
 * from a browser session; a cron call has none, so it needs to go the other way
 * — from the database outward. The service client is correct here precisely
 * because there is no user to act as: the caller was already authorised by
 * DIGEST_SECRET, and no org id is ever taken from client input.
 *
 * An org is included only when ALL of these hold:
 *   - it opted in         (digest_enabled)
 *   - Monday is connected (a token we can actually decrypt)
 *   - boards were chosen  (nothing to report on otherwise)
 *   - somebody receives it
 *   - it was not already sent within the guard window (see below)
 *
 * Anything that fails a check is skipped with a reason, never guessed at.
 */

/**
 * The idempotency guard: an org successfully mailed less than this long ago is
 * skipped. `digest_last_sent_at` was being WRITTEN on every success and read
 * by nothing — so a cron retry (Vercel re-fires on timeouts), a manual run on
 * top of the schedule, or a double-configured schedule mailed everyone twice.
 * 20 hours: short enough that tomorrow's deliberate manual run still goes out,
 * long enough that no same-day duplicate can. This is read-then-send, not a
 * transaction — two runs in the SAME SECOND could still race; the guard is
 * aimed at retries and double schedules, which arrive minutes apart.
 */
const RESEND_GUARD_MS = 20 * 60 * 60 * 1000;
export async function getDigestTargets(): Promise<{ targets: DigestTarget[]; skipped: { org: string; why: string }[] }> {
  const targets: DigestTarget[] = [];
  const skipped: { org: string; why: string }[] = [];

  const service = createServiceClient();
  if (!service) return { targets, skipped };

  const { data: orgs, error } = await service
    .from("organizations")
    .select("id, name, monday_token_encrypted, digest_enabled, digest_board_ids, digest_recipients, digest_last_sent_at")
    .eq("digest_enabled", true);

  if (error) {
    console.error("Reading digest targets failed:", error.message);
    return { targets, skipped };
  }

  for (const org of orgs ?? []) {
    const name = (org.name as string) ?? org.id;

    const lastSent = org.digest_last_sent_at ? Date.parse(org.digest_last_sent_at as string) : NaN;
    if (!Number.isNaN(lastSent) && Date.now() - lastSent < RESEND_GUARD_MS) {
      skipped.push({
        org: name,
        why: `נשלח כבר ב-${new Date(lastSent).toISOString()} — מדלגים כדי לא לשלוח פעמיים`,
      });
      continue;
    }

    // A saved spreadsheet is a digest source in its own right, so "no Monday"
    // and "no boards chosen" are no longer reasons to skip an org — only
    // reasons to have nothing FROM MONDAY in its email.
    const sheetSourceIds = await sheetSourceIdsFor(service, org.id as string);

    let token = "";
    if (org.monday_token_encrypted) {
      try {
        token = decrypt(org.monday_token_encrypted as string);
      } catch {
        // A key rotation makes every stored token unreadable. Say so plainly
        // instead of letting the run look merely empty.
        if (!sheetSourceIds.length) {
          skipped.push({ org: name, why: "הטוקן לא ניתן לפענוח — ייתכן ש-ENCRYPTION_KEY הוחלף" });
          continue;
        }
      }
    }

    const boardIds = token
      ? ((org.digest_board_ids as string[]) ?? []).filter((id) => /^\d+$/.test(id))
      : [];
    if (!boardIds.length && !sheetSourceIds.length) {
      skipped.push({
        org: name,
        why: org.monday_token_encrypted ? "לא נבחרו בורדים ואין גיליון שמור" : "מונדיי לא מחובר ואין גיליון שמור",
      });
      continue;
    }

    let recipients = ((org.digest_recipients as string[]) ?? []).filter(Boolean);
    if (!recipients.length) recipients = await memberEmails(service, org.id as string);
    if (!recipients.length) {
      skipped.push({ org: name, why: "אין נמען" });
      continue;
    }

    targets.push({ orgId: org.id as string, orgName: name, token, boardIds, sheetSourceIds, recipients });
  }

  return { targets, skipped };
}

/** The login emails of an org's members — the fallback when none were set. */
async function memberEmails(
  service: ReturnType<typeof createServiceClient>,
  orgId: string
): Promise<string[]> {
  if (!service) return [];
  const { data: members } = await service.from("org_users").select("user_id").eq("org_id", orgId);
  const out: string[] = [];
  for (const m of members ?? []) {
    const { data } = await service.auth.admin.getUserById(m.user_id as string);
    const email = data?.user?.email;
    if (email) out.push(email);
  }
  return out;
}
