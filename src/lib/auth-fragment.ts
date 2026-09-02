/**
 * Reading the auth result Supabase leaves in the URL fragment.
 *
 * There are two ways a session comes back from the auth server:
 *
 *   PKCE      →  /auth/callback?code=...            the server exchanges it
 *   implicit  →  /auth/callback#access_token=...    the BROWSER must read it
 *
 * A fragment is never sent to the server (RFC 3986 §3.5), so the callback route
 * handler is structurally blind to the second shape. Until this existed, an
 * implicit-flow link — an admin-generated link, a recovery link, a client that
 * dropped the query — arrived at a route that saw no `code`, concluded the
 * login had failed, and bounced the person to `?auth_error=1`. The login was
 * valid the whole time; nobody was reading it.
 */

export type FragmentResult =
  | { kind: "session"; accessToken: string; refreshToken: string }
  | { kind: "error"; code: string | null; description: string | null }
  | { kind: "none" };

/**
 * Parse `window.location.hash`. Accepts the value with or without its leading
 * `#`, and never throws — a fragment is untrusted input that arrives from a
 * mail client, and a parser crash here would be an unrecoverable login screen.
 */
export function parseAuthFragment(hash: string): FragmentResult {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return { kind: "none" };

  const params = new URLSearchParams(raw);

  // An error is reported even when tokens are somehow also present: the auth
  // server saying "no" outranks anything else in the fragment.
  const error = params.get("error") || params.get("error_code");
  if (error) {
    return {
      kind: "error",
      code: params.get("error_code") ?? params.get("error"),
      description: params.get("error_description"),
    };
  }

  // Both halves or nothing — see the test for why a lone access token is worse
  // than an honest failure.
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken) {
    return { kind: "session", accessToken, refreshToken };
  }

  return { kind: "none" };
}
