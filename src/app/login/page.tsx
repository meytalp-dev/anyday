"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseBrowser, isSupabaseConfigured } from "@/lib/supabase-browser";
import { fetchAuthSettings, isProviderEnabled } from "@/lib/auth-providers";

function LoginContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/app";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Starts hidden and appears only once the project confirms Google is on —
  // see lib/auth-providers.ts for why a dead button is worse than no button.
  const [googleOn, setGoogleOn] = useState(false);

  const configured = isSupabaseConfigured();

  useEffect(() => {
    let alive = true;
    fetchAuthSettings().then((s) => {
      if (alive) setGoogleOn(isProviderEnabled(s, "google"));
    });
    return () => {
      alive = false;
    };
  }, []);

  async function signInWithGoogle() {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    setErr(null);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(callbackUrl)}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) setErr(error.message);
  }

  async function signInWithEmail() {
    const supabase = getSupabaseBrowser();
    if (!supabase || !email.trim()) return;
    setBusy(true);
    setErr(null);
    const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(callbackUrl)}`;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--color-bg)", fontFamily: "var(--font-dm)",
      padding: 24, position: "relative", overflow: "hidden", direction: "rtl",
    }}>
      <div style={{
        position: "absolute", width: 300, height: 300, borderRadius: "50%",
        background: "var(--color-accent)", opacity: 0.06, top: -80, right: -60, filter: "blur(80px)",
      }} />
      <div style={{
        position: "absolute", width: 200, height: 200, borderRadius: "50%",
        background: "var(--color-accent)", opacity: 0.04, bottom: -40, left: -40, filter: "blur(60px)",
      }} />

      <div style={{ maxWidth: 420, width: "100%", textAlign: "center", position: "relative", zIndex: 1 }}>
        <div style={{
          width: 64, height: 64, borderRadius: 50, background: "var(--color-accent)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 24px", fontSize: 28, color: "var(--color-bg)", fontWeight: 900,
          boxShadow: "0 0 30px rgba(212,255,43,0.2)",
        }}>A</div>

        <h1 style={{
          fontSize: 36, fontWeight: 900, color: "var(--color-accent)", marginBottom: 8,
          letterSpacing: "-0.02em", fontFamily: "var(--font-syne)",
        }}>AnyDay</h1>

        <p style={{ fontSize: 16, color: "var(--color-muted)", marginBottom: 40, lineHeight: 1.6 }}>
          שכבת ניהול חכמה מעל ה-Monday שלכם
        </p>

        <div style={{
          background: "var(--color-surf)", borderRadius: 24, padding: "36px 32px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)", border: "1px solid var(--color-border)",
        }}>
          {!configured && (
            <div style={{
              background: "var(--color-amber-light)", color: "#8a6d00", borderRadius: 12,
              padding: "14px 16px", marginBottom: 20, fontSize: 13, lineHeight: 1.6, textAlign: "right",
            }}>
              ⚙️ ההתחברות עדיין לא מוגדרת. הזינו את מפתחות Supabase ב-<code>.env.local</code> כדי להפעיל התחברות אמיתית.
            </div>
          )}

          <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--color-text)", marginBottom: 8 }}>התחברות</h2>
          <p style={{ fontSize: 14, color: "var(--color-muted)", marginBottom: 28 }}>
            היכנסו כדי לבנות ולנהל את מערכות ה-Monday של הארגון שלכם
          </p>

          {googleOn && (<>
          <button
            onClick={signInWithGoogle}
            disabled={!configured}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
              background: "var(--color-surf)", border: "1px solid var(--color-border2)",
              borderRadius: 50, padding: "14px 24px", fontSize: 16, fontWeight: 600,
              color: "var(--color-text)", cursor: configured ? "pointer" : "not-allowed",
              opacity: configured ? 1 : 0.5, transition: "all 0.2s", fontFamily: "var(--font-dm)",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            התחברות עם Google
          </button>

          {/* The "or by email" divider only separates two things. With Google
              hidden there is nothing to separate, so it goes with the button. */}
          <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
            <span style={{ fontSize: 12, color: "var(--color-muted)" }}>או במייל</span>
            <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
          </div>
          </>)}

          {sent ? (
            <p style={{ marginTop: 20, fontSize: 14, color: "var(--color-green)", fontWeight: 600, lineHeight: 1.6 }}>
              ✅ שלחנו קישור התחברות ל-{email}. פִּתחו אותו כדי להיכנס.
            </p>
          ) : (
            <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                type="email"
                dir="ltr"
                placeholder="you@organization.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && signInWithEmail()}
                disabled={!configured}
                style={{
                  padding: "13px 16px", borderRadius: 12, border: "1px solid var(--color-border2)",
                  background: "var(--color-bg)", fontSize: 15, outline: "none", textAlign: "left",
                  fontFamily: "var(--font-dm)", color: "var(--color-text)",
                }}
              />
              <button
                onClick={signInWithEmail}
                disabled={!configured || busy || !email.trim()}
                style={{
                  background: "var(--color-accent-light)", border: "none", borderRadius: 50,
                  padding: "13px 24px", fontSize: 14, fontWeight: 700, color: "var(--color-accent)",
                  cursor: !configured || busy || !email.trim() ? "not-allowed" : "pointer",
                  opacity: !configured || busy || !email.trim() ? 0.5 : 1, fontFamily: "var(--font-dm)",
                }}
              >
                {busy ? "שולח..." : "שלחו לי קישור התחברות"}
              </button>
            </div>
          )}

          {err && (
            <p style={{ marginTop: 16, fontSize: 13, color: "var(--color-red)", fontWeight: 600 }}>{err}</p>
          )}

          <button
            onClick={() => (window.location.href = "/")}
            style={{
              width: "100%", marginTop: 20, background: "none", border: "none",
              padding: "10px", fontSize: 13, color: "var(--color-muted)", cursor: "pointer",
              fontFamily: "var(--font-dm)", textDecoration: "underline",
            }}
          >
            חזרה לדף הבית
          </button>
        </div>

        {/* This sentence used to be plain text, and the documents it promised
            did not exist — /terms and /privacy both answered 404. A consent
            line nobody can follow is worse than none: it asks for agreement
            to something unreadable. */}
        <p style={{ fontSize: 12, color: "var(--color-muted2)", marginTop: 24 }}>
          בהתחברות אתם מסכימים ל<a href="/terms" style={{ color: "inherit", textDecoration: "underline" }}>תנאי השימוש</a>
          {" ול"}<a href="/privacy" style={{ color: "inherit", textDecoration: "underline" }}>מדיניות הפרטיות</a>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg)", color: "var(--color-text)" }}>טוען...</div>}>
      <LoginContent />
    </Suspense>
  );
}
