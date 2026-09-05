/**
 * חברי הארגון — רשימה, שינוי תפקיד, הסרה.
 *
 * THE LAST-ADMIN RULE
 * An organisation with no admin is one nobody can disconnect Monday from,
 * invite to, or ever administer again — and no support path exists to repair
 * it. So the last admin cannot be removed and cannot be demoted, including by
 * themselves. That check lives here, in the only place that writes the column.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/session";
import { createServiceClient, isSupabaseServerConfigured } from "@/lib/supabase-server";
import { isRole, ROLE_LABEL, type Role } from "@/lib/roles";

function noStore(json: unknown, init?: { status?: number }) {
  return NextResponse.json(json, { status: init?.status ?? 200, headers: { "Cache-Control": "no-store" } });
}

async function gate(needAdmin: boolean) {
  if (!isSupabaseServerConfigured())
    return { err: noStore({ error: "ניהול חברים דורש חשבון ארגוני" }, { status: 503 }) };
  const ctx = await getOrgContext();
  if (!ctx) return { err: noStore({ error: "יש להתחבר כדי להמשיך" }, { status: 401 }) };
  if (needAdmin && ctx.role !== "admin")
    return { err: noStore({ error: "רק מנהל הארגון יכול לנהל חברים" }, { status: 403 }) };
  const service = createServiceClient();
  if (!service) return { err: noStore({ error: "אחסון לא זמין" }, { status: 503 }) };
  return { ctx, service };
}

type Svc = NonNullable<ReturnType<typeof createServiceClient>>;

/** How many admins this org has right now. */
async function adminCount(service: Svc, orgId: string): Promise<number | null> {
  const { count, error } = await service
    .from("org_users")
    .select("user_id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("role", "admin");
  return error ? null : count ?? null;
}

/** Everyone in the org. Readable by any member — knowing who else can see the
 *  organisation's data is not an admin-only fact. */
export async function GET() {
  const g = await gate(false);
  if ("err" in g) return g.err;
  const { ctx, service } = g;

  const { data, error } = await service
    .from("org_users")
    .select("user_id, role, created_at")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: true });

  if (error) return noStore({ error: "לא הצלחנו לקרוא את רשימת החברים" }, { status: 500 });

  // Addresses live in auth.users, which only the service key may read.
  const emails = new Map<string, string>();
  for (const row of data ?? []) {
    const { data: u } = await service.auth.admin.getUserById(row.user_id as string);
    if (u?.user?.email) emails.set(row.user_id as string, u.user.email);
  }

  return noStore({
    you: { userId: ctx.userId, role: ctx.role },
    orgName: ctx.orgName,
    members: (data ?? []).map((r) => ({
      userId: r.user_id as string,
      email: emails.get(r.user_id as string) ?? "—",
      role: r.role as string,
      roleLabel: ROLE_LABEL[(r.role as Role)] ?? (r.role as string),
      isYou: r.user_id === ctx.userId,
    })),
  });
}

/** Change one member's role. */
export async function PATCH(req: NextRequest) {
  const g = await gate(true);
  if ("err" in g) return g.err;
  const { ctx, service } = g;

  const body = await req.json().catch(() => ({}));
  const userId = typeof body?.userId === "string" ? body.userId : "";
  if (!userId) return noStore({ error: "חסר מזהה משתמש" }, { status: 400 });
  if (!isRole(body?.role)) return noStore({ error: "תפקיד לא מוכר" }, { status: 400 });
  const role: Role = body.role;

  if (role !== "admin") {
    const admins = await adminCount(service, ctx.orgId);
    if (admins === null) return noStore({ error: "לא הצלחנו לאמת את מצב המנהלים" }, { status: 500 });
    const { data: current } = await service
      .from("org_users").select("role").eq("org_id", ctx.orgId).eq("user_id", userId).maybeSingle();
    if (current?.role === "admin" && admins <= 1) {
      return noStore({ error: "זה המנהל האחרון בארגון. מנו מנהל נוסף לפני שמורידים אותו בדרגה." }, { status: 409 });
    }
  }

  const { error } = await service
    .from("org_users").update({ role }).eq("org_id", ctx.orgId).eq("user_id", userId);
  if (error) return noStore({ error: "לא הצלחנו לעדכן את התפקיד" }, { status: 500 });
  return noStore({ ok: true, role });
}

/** Remove someone from the organisation. */
export async function DELETE(req: NextRequest) {
  const g = await gate(true);
  if ("err" in g) return g.err;
  const { ctx, service } = g;

  const userId = req.nextUrl.searchParams.get("userId") ?? "";
  if (!userId) return noStore({ error: "חסר מזהה משתמש" }, { status: 400 });

  const { data: current } = await service
    .from("org_users").select("role").eq("org_id", ctx.orgId).eq("user_id", userId).maybeSingle();
  if (!current) return noStore({ error: "החבר הזה לא נמצא בארגון" }, { status: 404 });

  if (current.role === "admin") {
    const admins = await adminCount(service, ctx.orgId);
    if (admins === null) return noStore({ error: "לא הצלחנו לאמת את מצב המנהלים" }, { status: 500 });
    if (admins <= 1) {
      return noStore({ error: "זה המנהל האחרון בארגון ואי אפשר להסיר אותו." }, { status: 409 });
    }
  }

  const { error } = await service
    .from("org_users").delete().eq("org_id", ctx.orgId).eq("user_id", userId);
  if (error) return noStore({ error: "לא הצלחנו להסיר את החבר" }, { status: 500 });
  return noStore({ ok: true });
}
