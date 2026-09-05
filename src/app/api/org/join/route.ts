/**
 * מימוש ההזמנה.
 *
 * GET  — "לאיזה ארגון הוזמנתי?" Answers from the token alone, before login,
 *        so the join screen can name the organization instead of asking
 *        somebody to sign in to find out what they are signing into.
 * POST — the join itself, and only from an explicit click.
 *
 * WHY NOT MATCH ON THE EMAIL ADDRESS
 * It would be convenient to notice that a new signup's address has a pending
 * invitation and put them in that organization automatically. It would also
 * mean that inviting an address is enough to pull whoever later registers it
 * into a stranger's data, without them ever agreeing. The token proves the
 * person holds the letter; the click proves they accept it. Both are required.
 *
 * WHY THE BOOTSTRAP DOES NOT FIGHT THIS
 * getOrgContext() creates an organization for any authenticated user who has
 * none. Someone arriving from an invitation link signs in and lands here
 * first, so the membership is written before anything else asks for a context.
 * When they DO already have one, it is replaced — but only after proving there
 * is nothing in it to lose (canReplaceOrg).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase, createServiceClient, isSupabaseServerConfigured } from "@/lib/supabase-server";
import { hashInviteToken, checkInvite, canReplaceOrg, ORG_NOT_EMPTY_MESSAGE, type InviteRow } from "@/lib/invites";
import { ROLE_LABEL } from "@/lib/roles";

function noStore(json: unknown, init?: { status?: number }) {
  return NextResponse.json(json, { status: init?.status ?? 200, headers: { "Cache-Control": "no-store" } });
}

const MISSING_TABLE = "טבלת ההזמנות לא קיימת עדיין. הריצו את supabase-schema-v8.sql ב-Supabase.";
const isMissingTable = (msg?: string) =>
  !!msg && msg.includes("org_invites") && (msg.includes("does not exist") || msg.includes("schema cache"));

/** Look the token up and read the organization's name alongside it. */
async function loadInvite(token: string) {
  const service = createServiceClient();
  if (!service) return { error: "אחסון לא זמין", status: 503 as const };

  const { data, error } = await service
    .from("org_invites")
    .select("id, org_id, role, expires_at, accepted_at, organizations(name)")
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle();

  if (error) {
    if (isMissingTable(error.message)) return { error: MISSING_TABLE, status: 503 as const };
    console.error("invite lookup failed:", error.message);
    return { error: "לא הצלחנו לקרוא את ההזמנה", status: 500 as const };
  }
  const orgName = (data?.organizations as unknown as { name?: string } | null)?.name ?? "הארגון";
  return { service, row: (data as unknown as (InviteRow & { id: string }) | null), orgName, id: data?.id as string | undefined };
}

export async function GET(req: NextRequest) {
  if (!isSupabaseServerConfigured())
    return noStore({ error: "הזמנות דורשות חשבון ארגוני" }, { status: 503 });

  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!token) return noStore({ error: "חסר קוד הזמנה" }, { status: 400 });

  const found = await loadInvite(token);
  if ("error" in found) return noStore({ error: found.error }, { status: found.status });

  const verdict = checkInvite(found.row, new Date());
  if (!verdict.ok) return noStore({ error: verdict.message, reason: verdict.reason }, { status: 410 });

  return noStore({
    orgName: found.orgName,
    role: verdict.role,
    roleLabel: ROLE_LABEL[verdict.role],
  });
}

export async function POST(req: NextRequest) {
  if (!isSupabaseServerConfigured())
    return noStore({ error: "הזמנות דורשות חשבון ארגוני" }, { status: 503 });

  const supabase = await createServerSupabase();
  const { data: { user } = { user: null } } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };
  if (!user) return noStore({ error: "יש להתחבר כדי להצטרף" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) return noStore({ error: "חסר קוד הזמנה" }, { status: 400 });

  const found = await loadInvite(token);
  if ("error" in found) return noStore({ error: found.error }, { status: found.status });
  const { service, row, orgName, id } = found;

  const verdict = checkInvite(row, new Date());
  if (!verdict.ok) return noStore({ error: verdict.message, reason: verdict.reason }, { status: 410 });

  // Already in this organization: nothing to do, and saying "you are in" is
  // the truthful answer to someone who clicked the link twice.
  const { data: existing } = await service
    .from("org_users")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (existing?.org_id === verdict.orgId) {
    return noStore({ ok: true, orgName, alreadyMember: true });
  }

  if (existing?.org_id) {
    const priorOrg = existing.org_id as string;
    if (!(await orgIsEmpty(service, priorOrg))) {
      return noStore({ error: ORG_NOT_EMPTY_MESSAGE, reason: "orgNotEmpty" }, { status: 409 });
    }
    // Untouched bootstrap organization: leaving it behind loses nothing, and
    // the cascade takes the empty row with it.
    await service.from("org_users").delete().eq("user_id", user.id).eq("org_id", priorOrg);
    await service.from("organizations").delete().eq("id", priorOrg);
  }

  const { error: joinErr } = await service.from("org_users").upsert(
    { org_id: verdict.orgId, user_id: user.id, role: verdict.role },
    { onConflict: "org_id,user_id" }
  );
  if (joinErr) {
    console.error("join failed:", joinErr.message);
    return noStore({ error: "ההצטרפות נכשלה" }, { status: 500 });
  }

  // Burn the invitation. A link that already worked must not work again: it
  // may live on in a forwarded email long after the person joined.
  await service
    .from("org_invites")
    .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
    .eq("id", id!);

  return noStore({ ok: true, orgName, role: verdict.role });
}

/** PostgREST's "no such table", which is a real zero rather than a mystery. */
function isMissingRelation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "PGRST205" || err.code === "42P01" ||
    (err.message ?? "").includes("Could not find the table");
}

/** A row count, or -1 when the answer genuinely is not known. */
function countOrUnknown(res: { count: number | null; error: { code?: string; message?: string } | null }): number {
  if (isMissingRelation(res.error)) return 0;
  if (res.error || res.count === null) return -1;
  return res.count;
}

/** Is there anything in this organization worth keeping? */
async function orgIsEmpty(
  service: NonNullable<ReturnType<typeof createServiceClient>>,
  orgId: string
): Promise<boolean> {
  const [members, org, dashboards, sheets] = await Promise.all([
    service.from("org_users").select("user_id", { count: "exact", head: true }).eq("org_id", orgId),
    service.from("organizations").select("monday_token_encrypted").eq("id", orgId).maybeSingle(),
    service.from("dashboards").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    service.from("sheet_sources").select("id", { count: "exact", head: true }).eq("org_id", orgId),
  ]);

  // Unknowns count AGAINST deleting — but "the table does not exist" is not an
  // unknown. A table that was never created is holding nothing, definitively,
  // and treating that as "might hold something" refuses every join on a
  // deployment where one migration has not been run yet. Anything else that
  // errors really is unknown, and unknown means we do not delete.
  const saved = countOrUnknown(dashboards) + countOrUnknown(sheets);
  if (members.error || org.error || members.count === null || saved < 0) return false;

  return canReplaceOrg({
    memberCount: members.count,
    mondayConnected: Boolean(org.data?.monday_token_encrypted),
    savedThings: saved,
  });
}
