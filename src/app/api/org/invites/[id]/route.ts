/**
 * ביטול הזמנה.
 *
 * Deleting the row is the revocation: the link carries a token whose only
 * meaning is that its hash is in this table, so removing the row makes every
 * copy of that link inert at once — including one already forwarded to
 * somebody the admin did not mean to invite.
 */

import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/session";
import { createServiceClient, isSupabaseServerConfigured } from "@/lib/supabase-server";

function noStore(json: unknown, init?: { status?: number }) {
  return NextResponse.json(json, { status: init?.status ?? 200, headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseServerConfigured())
    return noStore({ error: "הזמנות דורשות חשבון ארגוני" }, { status: 503 });

  const ctx = await getOrgContext();
  if (!ctx) return noStore({ error: "יש להתחבר כדי להמשיך" }, { status: 401 });
  if (ctx.role !== "admin")
    return noStore({ error: "רק מנהל הארגון יכול לבטל הזמנה" }, { status: 403 });

  const service = createServiceClient();
  if (!service) return noStore({ error: "אחסון לא זמין" }, { status: 503 });

  const { id } = await params;

  // Scoped to the caller's org: an id from another organization matches
  // nothing here, so it cannot be revoked by guessing.
  const { error } = await service
    .from("org_invites")
    .delete()
    .eq("id", id)
    .eq("org_id", ctx.orgId);

  if (error) {
    console.error("invite revoke failed:", error.message);
    return noStore({ error: "לא הצלחנו לבטל את ההזמנה" }, { status: 500 });
  }
  return noStore({ ok: true });
}
