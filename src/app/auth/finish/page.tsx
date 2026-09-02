"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { parseAuthFragment } from "@/lib/auth-fragment";

/**
 * The browser half of the auth callback.
 *
 * /auth/callback runs on the server and can only see `?code=`. When a session
 * comes back in the URL fragment instead, the server is blind to it and hands
 * off here — the fragment rides along, because a browser re-attaches it to a
 * redirect that carries none of its own. This page reads it, installs the
 * session, and continues.
 *
 * It is also where a login that genuinely failed finally gets EXPLAINED. The
 * old behaviour was `?auth_error=1` in the address bar and an unchanged login
 * screen, which reads as "the button does nothing" — the single most common
 * thing an expired link looked like.
 */

type State =
  | { s: "working" }
  | { s: "failed"; title: string; detail: string };

type Failed = Extract<State, { s: "failed" }>;

/**
 * Read the fragment, install the session, and navigate on. Resolves to the
 * failure to display, or to `null` when the login succeeded and the browser is
 * already on its way to `next`.
 */
async function completeLogin(next: string): Promise<Failed | null> {
  const result = parseAuthFragment(window.location.hash);

  // Tokens must not sit in the address bar or linger in history.
  if (window.location.hash) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  if (result.kind === "error") {
    const expired = result.code === "otp_expired";
    return {
      s: "failed",
      title: expired ? "הקישור כבר לא בתוקף" : "ההתחברות לא הושלמה",
      detail: expired
        ? "קישור התחברות הוא חד-פעמי, והוא פג אחרי שעה. בקשו קישור חדש והיכנסו איתו — זה ייקח רגע."
        : result.description || "שרת ההתחברות דחה את הבקשה. נסו שוב.",
    };
  }

  if (result.kind === "none") {
    return {
      s: "failed",
      title: "ההתחברות לא הושלמה",
      detail:
        "לא הגיעו איתך פרטי התחברות. זה קורה כששולחים את הקישור הלאה, פותחים אותו פעמיים, או מעתיקים רק חלק ממנו. בקשו קישור חדש ופתחו אותו ישירות.",
    };
  }

  const supabase = getSupabaseBrowser();
  if (!supabase) {
    return { s: "failed", title: "ההתחברות לא מוגדרת", detail: "חסרות הגדרות Supabase בשרת." };
  }

  const { error } = await supabase.auth.setSession({
    access_token: result.accessToken,
    refresh_token: result.refreshToken,
  });
  if (error) {
    return { s: "failed", title: "ההתחברות לא הושלמה", detail: error.message };
  }

  // A full navigation, not a client push: the middleware has to see the
  // session cookie that setSession just wrote.
  window.location.replace(next);
  return null;
}

function Finish() {
  const params = useSearchParams();
  const nextRaw = params.get("next") || "/app";
  const next = nextRaw.startsWith("/") ? nextRaw : "/app";
  const [state, setState] = useState<State>({ s: "working" });

  useEffect(() => {
    let alive = true;
    completeLogin(next).then((outcome) => {
      // `null` means we navigated away — leave the screen on "working" rather
      // than flashing a result behind the departing page.
      if (alive && outcome) setState(outcome);
    });
    return () => {
      alive = false;
    };
  }, [next]);

  return (
    <div dir="rtl" style={{
      minHeight: "100vh", display: "grid", placeItems: "center", padding: 24,
      background: "var(--color-bg)", color: "var(--color-text)", fontFamily: "var(--font-dm)",
    }}>
      <div style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
        {state.s === "working" ? (
          <p style={{ fontSize: 15, color: "var(--color-muted)" }}>רגע, מכניסים אתכם…</p>
        ) : (
          <div style={{
            background: "var(--color-surf)", border: "1px solid var(--color-border)",
            borderRadius: 24, padding: "34px 30px",
          }}>
            <h1 style={{ fontSize: 21, fontWeight: 800, margin: "0 0 10px" }}>{state.title}</h1>
            <p style={{ fontSize: 14.5, color: "var(--color-muted)", lineHeight: 1.75, margin: "0 0 26px" }}>
              {state.detail}
            </p>
            <a href="/login" style={{
              display: "block", background: "var(--color-accent-light)", color: "var(--color-accent)",
              borderRadius: 50, padding: "13px 24px", fontSize: 15, fontWeight: 700, textDecoration: "none",
            }}>
              לבקש קישור חדש
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AuthFinishPage() {
  return (
    <Suspense fallback={null}>
      <Finish />
    </Suspense>
  );
}
