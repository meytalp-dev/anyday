import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

/**
 * Supabase Auth callback. Google OAuth and magic-link both land here with a
 * `code` we exchange for a session (stored in cookies), then continue to `next`.
 *
 * Not every valid login arrives that way. An implicit-flow link carries the
 * session in the URL FRAGMENT instead, which a server never receives — this
 * route used to read that as failure and bounce a logged-in person to
 * `?auth_error=1`. So the no-code path now hands off to /auth/finish, a client
 * page that can read the fragment. Browsers re-attach a fragment to a redirect
 * target that has none of its own, so `#access_token=...` survives the hop.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/app";
  const safeNext = next.startsWith("/") ? next : "/app";

  if (code) {
    const supabase = await createServerSupabase();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(`${url.origin}${safeNext}`);
      }
    }
  }

  return NextResponse.redirect(
    `${url.origin}/auth/finish?next=${encodeURIComponent(safeNext)}`
  );
}
