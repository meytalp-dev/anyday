/**
 * הזמנות לארגון — יצירה ורשימה.
 *
 * Only an admin may invite, and the invitation is created with the service
 * client rather than through RLS: the row has to be readable later by someone
 * who is not in the organization yet, which is exactly the case RLS cannot
 * express. The gate is therefore in this file, and it is the only gate.
 *
 * The response returns the LINK, not just a promise that mail was sent.
 * anyday.co.il has neither SPF nor DKIM, so Resend cannot deliver to a
 * stranger today — an invitation that only went out by email would be an
 * invitation that silently never arrived. The admin copies the link and sends
 * it however they already talk to their team; the email is a convenience that
 * starts working by itself once the DNS records exist.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/session";
import { createServiceClient, isSupabaseServerConfigured } from "@/lib/supabase-server";
import { rateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/send-email";
import { isRole, ROLE_LABEL, type Role } from "@/lib/roles";
import {
  newInviteToken, hashInviteToken, normalizeEmail, expiryFrom, inviteLink,
  INVITE_TTL_DAYS,
} from "@/lib/invites";

function noStore(json: unknown, init?: { status?: number }) {
  return NextResponse.json(json, { status: init?.status ?? 200, headers: { "Cache-Control": "no-store" } });
}

/** The table arrives with schema v8. Until it is run, say so in words rather
 *  than leaking a Postgres error — the schemas are applied by hand. */
const MISSING_TABLE = "טבלת ההזמנות לא קיימת עדיין. הריצו את supabase-schema-v8.sql ב-Supabase.";
const isMissingTable = (msg?: string) =>
  !!msg && (msg.includes("org_invites") && (msg.includes("does not exist") || msg.includes("schema cache")));

async function requireAdmin() {
  if (!isSupabaseServerConfigured())
    return { err: noStore({ error: "הזמנת חברים דורשת חשבון ארגוני" }, { status: 503 }) };
  const ctx = await getOrgContext();
  if (!ctx) return { err: noStore({ error: "יש להתחבר כדי להמשיך" }, { status: 401 }) };
  if (ctx.role !== "admin")
    return { err: noStore({ error: "רק מנהל הארגון יכול להזמין חברים" }, { status: 403 }) };
  const service = createServiceClient();
  if (!service) return { err: noStore({ error: "אחסון לא זמין" }, { status: 503 }) };
  return { ctx, service };
}

/** Pending invitations, so the members screen can show who has not joined. */
export async function GET() {
  const gate = await requireAdmin();
  if ("err" in gate) return gate.err;
  const { ctx, service } = gate;

  const { data, error } = await service
    .from("org_invites")
    .select("id, email, role, expires_at, created_at")
    .eq("org_id", ctx.orgId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingTable(error.message)) return noStore({ error: MISSING_TABLE }, { status: 503 });
    return noStore({ error: "לא הצלחנו לקרוא את ההזמנות" }, { status: 500 });
  }

  const now = Date.now();
  return noStore({
    invites: (data ?? []).map((r) => ({
      id: r.id as string,
      email: r.email as string,
      role: r.role as string,
      expired: new Date(r.expires_at as string).getTime() <= now,
    })),
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if ("err" in gate) return gate.err;
  const { ctx, service } = gate;

  // An invitation sends mail and mints a credential. Neither should be
  // available in bulk to a script that got hold of one admin session.
  const rl = rateLimit("org-invite", ctx.orgId, 20, 60 * 60_000);
  if (!rl.ok) return noStore({ error: RATE_LIMIT_MESSAGE }, { status: 429, });

  const body = await req.json().catch(() => ({}));
  const email = normalizeEmail(body?.email);
  if (!email) return noStore({ error: "הזינו כתובת דוא״ל תקינה" }, { status: 400 });

  const role: Role = isRole(body?.role) ? body.role : "member";

  const token = newInviteToken();
  const now = new Date();

  // Re-inviting the same address replaces the live invitation rather than
  // adding a second one: it is the same promise, and two valid links to the
  // same seat is one link nobody can revoke.
  const { error } = await service
    .from("org_invites")
    .upsert(
      {
        org_id: ctx.orgId,
        email,
        role,
        token_hash: hashInviteToken(token),
        invited_by: ctx.userId,
        expires_at: expiryFrom(now),
        accepted_at: null,
      },
      { onConflict: "org_id,email" }
    );

  if (error) {
    if (isMissingTable(error.message)) return noStore({ error: MISSING_TABLE }, { status: 503 });
    console.error("invite create failed:", error.message);
    return noStore({ error: "לא הצלחנו ליצור את ההזמנה" }, { status: 500 });
  }

  const origin = req.nextUrl.origin;
  const link = inviteLink(origin, token);

  // Best effort, and reported honestly: the screen shows the link either way,
  // so a mail that cannot be delivered costs the admin nothing.
  let emailed = false;
  try {
    emailed = await sendInviteEmail(email, ctx.orgName, role, link);
  } catch {
    emailed = false;
  }

  return noStore({ link, emailed, email, role, expiresInDays: INVITE_TTL_DAYS });
}

async function sendInviteEmail(to: string, orgName: string, role: Role, link: string): Promise<boolean> {
  const subject = `הוזמנתם לארגון ${orgName} ב-AnyDay`;
  const html = `
    <div dir="rtl" style="font-family:Rubik,Assistant,Arial,sans-serif;color:#1B1830;line-height:1.8">
      <h2 style="margin:0 0 12px">הוזמנתם ל-${escapeHtml(orgName)}</h2>
      <p style="margin:0 0 16px">
        קיבלתם גישה בתפקיד <b>${ROLE_LABEL[role]}</b>. AnyDay מציגה את הלוחות של הארגון
        כתמונת מצב קריאה — בלי הגדרות.
      </p>
      <p style="margin:0 0 20px">
        <a href="${link}" style="background:#6C4CF1;color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;display:inline-block;font-weight:700">
          הצטרפות לארגון
        </a>
      </p>
      <p style="margin:0;font-size:13px;color:#7C7A93">
        הקישור תקף ${INVITE_TTL_DAYS} יום. אם לא ציפיתם להזמנה הזו, אפשר להתעלם ממנה.
      </p>
    </div>`;
  const res = await sendEmail({ to, subject, html });
  return res?.ok === true;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
