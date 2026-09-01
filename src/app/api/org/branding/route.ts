/**
 * /api/org/branding — the organization's logo, brand colour and display name.
 *
 * W1 of the BI board: every org sees ITS dashboard, not a generic product.
 * The logo lands in the public `logos` storage bucket (created by
 * supabase-schema-v6.sql) so the digest email can embed it as a real URL —
 * mail clients block data: URIs, so storing the image inline would brand the
 * screen and leave the email generic.
 *
 * Everything is scoped to the caller's own org from the session — an org id is
 * never accepted from the client. Writing is an admin decision, same wall as
 * the digest settings: RLS (v5: organizations UPDATE = admin only) is the real
 * enforcement, the role check here exists so refusal is a clear Hebrew 403.
 *
 * GET    → { orgName, logoUrl, brandColor, role }
 * POST   → multipart/form-data: `logo` (png/jpeg/webp ≤ 512KB, optional),
 *          `brandColor` (#rrggbb, optional, empty string clears)
 * DELETE → remove the logo (file + column)
 */

import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/session";
import { createServiceClient, isSupabaseServerConfigured } from "@/lib/supabase-server";
import { rateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "logos";
const MAX_LOGO_BYTES = 512 * 1024;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// SVG is deliberately absent: it can carry scripts and the file is served
// from our own origin. A raster logo brands just as well and cannot execute.
const LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function noStore(json: unknown, init?: { status?: number }) {
  return NextResponse.json(json, { ...init, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  if (!isSupabaseServerConfigured())
    return noStore({ orgName: null, logoUrl: null, brandColor: null, role: null });

  const ctx = await getOrgContext();
  if (!ctx) return noStore({ error: "יש להתחבר כדי להמשיך" }, { status: 401 });

  const service = createServiceClient();
  if (!service) return noStore({ error: "אחסון לא זמין" }, { status: 503 });

  // Tolerant read: before v6 has been run these columns do not exist, and the
  // product must degrade to "no branding", not to an error banner.
  const { data, error } = await service
    .from("organizations")
    .select("name, logo_url, brand_color")
    .eq("id", ctx.orgId)
    .single();
  if (error || !data)
    return noStore({ orgName: ctx.orgName, logoUrl: null, brandColor: null, role: ctx.role });

  return noStore({
    orgName: (data.name as string) ?? ctx.orgName,
    logoUrl: (data.logo_url as string) ?? null,
    brandColor: (data.brand_color as string) ?? null,
    role: ctx.role,
  });
}

/** Resolve context + admin gate, shared by POST and DELETE. */
async function requireAdmin() {
  if (!isSupabaseServerConfigured())
    return { err: noStore({ error: "מיתוג דורש חשבון ארגוני (Supabase לא מוגדר)" }, { status: 503 }) };
  const ctx = await getOrgContext();
  if (!ctx) return { err: noStore({ error: "יש להתחבר כדי להמשיך" }, { status: 401 }) };
  if (ctx.role !== "admin")
    return { err: noStore({ error: "רק אדמין יכול לשנות את מיתוג הארגון" }, { status: 403 }) };
  const service = createServiceClient();
  if (!service) return { err: noStore({ error: "אחסון לא זמין" }, { status: 503 }) };
  return { ctx, service };
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if ("err" in gate) return gate.err;
  const { ctx, service } = gate;

  const rl = rateLimit("org-branding", ctx.orgId, 10, 60_000);
  if (!rl.ok)
    return noStore({ error: RATE_LIMIT_MESSAGE }, { status: 429 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return noStore({ error: "יש לשלוח multipart/form-data" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  const color = form.get("brandColor");
  if (typeof color === "string") {
    const c = color.trim();
    if (c === "") patch.brand_color = null;
    else if (HEX_COLOR.test(c)) patch.brand_color = c;
    else return noStore({ error: "צבע המותג חייב להיות בפורמט ‎#rrggbb" }, { status: 400 });
  }

  const logo = form.get("logo");
  if (logo instanceof File && logo.size > 0) {
    const ext = LOGO_TYPES[logo.type];
    if (!ext)
      return noStore({ error: "הלוגו חייב להיות PNG, JPG או WebP" }, { status: 400 });
    if (logo.size > MAX_LOGO_BYTES)
      return noStore({ error: "הלוגו גדול מדי — עד 512KB" }, { status: 400 });

    const path = `${ctx.orgId}.${ext}`;
    const bytes = Buffer.from(await logo.arrayBuffer());
    const { error: upErr } = await service.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: logo.type, upsert: true });
    if (upErr)
      return noStore(
        { error: `העלאת הלוגו נכשלה: ${upErr.message}. ודאו ש-supabase-schema-v6.sql הורצה (היא יוצרת את ה-bucket)` },
        { status: 502 }
      );

    // A fresh query param busts every cache of the previous logo at this path.
    const { data: pub } = service.storage.from(BUCKET).getPublicUrl(path);
    patch.logo_url = `${pub.publicUrl}?v=${Date.now()}`;
  }

  if (!Object.keys(patch).length)
    return noStore({ error: "לא נשלח מה לעדכן — צרפו לוגו או צבע" }, { status: 400 });

  const { data, error } = await service
    .from("organizations")
    .update(patch)
    .eq("id", ctx.orgId)
    .select("name, logo_url, brand_color")
    .single();
  if (error || !data)
    return noStore(
      { error: `${error?.message ?? "העדכון נכשל"} — ודאו ש-supabase-schema-v6.sql הורצה` },
      { status: 502 }
    );

  return noStore({
    ok: true,
    orgName: (data.name as string) ?? ctx.orgName,
    logoUrl: (data.logo_url as string) ?? null,
    brandColor: (data.brand_color as string) ?? null,
    role: ctx.role,
  });
}

export async function DELETE() {
  const gate = await requireAdmin();
  if ("err" in gate) return gate.err;
  const { ctx, service } = gate;

  // Remove every extension variant — the org may have replaced png with webp.
  const paths = Object.values(LOGO_TYPES).map((ext) => `${ctx.orgId}.${ext}`);
  await service.storage.from(BUCKET).remove(paths); // missing files are not an error

  const { error } = await service
    .from("organizations")
    .update({ logo_url: null })
    .eq("id", ctx.orgId);
  if (error) return noStore({ error: error.message }, { status: 502 });

  return noStore({ ok: true, logoUrl: null });
}
