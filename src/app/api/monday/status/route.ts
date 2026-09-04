import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/session";
import { isSupabaseServerConfigured } from "@/lib/supabase-server";
import { personalTokenAllowed } from "@/lib/monday-server";

/**
 * Tells the client the current Monday connection state for the logged-in
 * user's org — WITHOUT ever exposing the token itself.
 *
 * It also reports whether the personal-token route is open (`personalToken`).
 * Only the server knows: the gate is an env decision. Screens that used to
 * offer that route unconditionally sent people to a 403, so they ask here
 * first — and fail closed, exactly as the social-login buttons do.
 */
export async function GET() {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ configured: false, authed: false, connected: false, personalToken: personalTokenAllowed() });
  }
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json({ configured: true, authed: false, connected: false, personalToken: personalTokenAllowed() });
  }
  return NextResponse.json({
    configured: true,
    authed: true,
    connected: ctx.mondayConnected,
    orgName: ctx.orgName,
    accountName: ctx.mondayAccountName,
    personalToken: personalTokenAllowed(),
  });
}
