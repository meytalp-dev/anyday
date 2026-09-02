/**
 * Which social login providers this Supabase project actually has switched on.
 *
 * The login screen used to render "התחברות עם Google" unconditionally. The
 * provider was never enabled in the project, so the button was a dead end: a
 * visitor clicked it and nothing happened at all. A person meeting the product
 * for the first time reads that as broken software, not as missing config.
 *
 * Supabase publishes the answer on an unauthenticated endpoint, so the screen
 * can simply ask before it draws. Enable Google in the dashboard and the button
 * comes back on its own — no deploy, and no flag to remember to flip.
 */

const SETTINGS_TIMEOUT_MS = 4000;

/**
 * Read one provider out of a `/auth/v1/settings` body.
 *
 * Fails CLOSED: anything that is not a literal `true` — a missing key, an error
 * body, a truthy string, a failed fetch — counts as "not available". Hiding a
 * working button costs a visitor one alternative click; showing a dead one
 * costs their trust in the product.
 */
export function isProviderEnabled(settings: unknown, provider: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const external = (settings as { external?: unknown }).external;
  if (typeof external !== "object" || external === null) return false;
  return (external as Record<string, unknown>)[provider] === true;
}

/**
 * Ask the project which providers are on. Never throws and never hangs the
 * login screen: any failure resolves to an empty answer, which -- per the
 * fail-closed rule above -- hides the social buttons and leaves the email
 * route, which needs no provider config at all.
 */
export async function fetchAuthSettings(): Promise<unknown> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  try {
    const res = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: anon },
      signal: AbortSignal.timeout(SETTINGS_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
