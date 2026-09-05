"use client";

/**
 * מסך ההצטרפות.
 *
 * It names the organization BEFORE asking anyone to sign in. Being told to log
 * in first and find out afterwards what you joined is how people end up
 * agreeing to things they did not read — and this link grants access to
 * another organisation's data, so the order matters.
 *
 * The join itself is a click. Never automatic, not even for a person who is
 * already signed in with the address that was invited.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

const GRAPE = "#6C4CF1";
const INK = "#1B1830";
const MUTED = "#7C7A93";

type Preview = { orgName: string; roleLabel: string };
type Phase = "loading" | "ready" | "dead" | "joining" | "joined";

function JoinContent() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  // A link with no token is already dead at first render; deriving that beats
  // rendering "loading" for a frame and then correcting it from an effect.
  const [phase, setPhase] = useState<Phase>(token ? "loading" : "dead");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [msg, setMsg] = useState<string>(token ? "" : "הקישור חסר קוד הזמנה.");

  useEffect(() => {
    if (!token) return;
    let live = true;
    fetch(`/api/org/join?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }))
      .then(({ ok, body }) => {
        if (!live) return;
        if (!ok) { setPhase("dead"); setMsg(body.error ?? "ההזמנה אינה תקפה."); return; }
        setPreview({ orgName: body.orgName, roleLabel: body.roleLabel });
        setPhase("ready");
      })
      .catch(() => { if (live) { setPhase("dead"); setMsg("לא הצלחנו לבדוק את ההזמנה."); } });
    return () => { live = false; };
  }, [token]);

  const join = useCallback(async () => {
    setPhase("joining"); setMsg("");
    try {
      const res = await fetch("/api/org/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        // Not signed in yet: send them through login and come straight back
        // here, so the click they already made is the one that completes.
        const next = encodeURIComponent(`/join?token=${encodeURIComponent(token)}`);
        router.push(`/login?callbackUrl=${next}`);
        return;
      }
      if (!res.ok) { setPhase("ready"); setMsg(body.error ?? "ההצטרפות נכשלה."); return; }
      setPreview((p) => ({ orgName: body.orgName ?? p?.orgName ?? "הארגון", roleLabel: p?.roleLabel ?? "" }));
      setPhase("joined");
      setTimeout(() => router.push("/app"), 1400);
    } catch {
      setPhase("ready"); setMsg("לא הצלחנו להשלים את ההצטרפות.");
    }
  }, [token, router]);

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: "#F4F3FB", color: INK, display: "grid", placeItems: "center", padding: 24, fontFamily: "Rubik, Assistant, Heebo, system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 460, background: "#fff", borderRadius: 22, padding: "34px 30px", boxShadow: "0 18px 50px -28px rgba(60,50,120,.45)", textAlign: "center" }}>
        <div style={{ width: 54, height: 54, borderRadius: 17, background: `linear-gradient(135deg,${GRAPE},#FF2D87)`, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 25, margin: "0 auto 18px" }}>A</div>

        {phase === "loading" && <p style={{ color: MUTED, margin: 0 }}>בודקים את ההזמנה…</p>}

        {phase === "dead" && (
          <>
            <h1 style={{ fontSize: 21, fontWeight: 800, margin: "0 0 10px" }}>ההזמנה אינה תקפה</h1>
            <p style={{ color: MUTED, fontSize: 14.5, lineHeight: 1.8, margin: "0 0 20px" }}>{msg}</p>
            <Link href="/" style={{ color: GRAPE, fontSize: 13.5 }}>חזרה לדף הבית</Link>
          </>
        )}

        {(phase === "ready" || phase === "joining") && preview && (
          <>
            <h1 style={{ fontSize: 22.5, fontWeight: 800, margin: "0 0 8px", lineHeight: 1.45 }}>
              הוזמנתם ל{preview.orgName}
            </h1>
            <p style={{ color: MUTED, fontSize: 14.5, lineHeight: 1.8, margin: "0 0 22px" }}>
              תפקיד: <b style={{ color: INK }}>{preview.roleLabel}</b>. אחרי ההצטרפות תראו את
              הלוחות של הארגון כתמונת מצב קריאה.
            </p>
            {msg && <p style={{ color: "#E5484D", fontSize: 13.5, fontWeight: 600, margin: "0 0 14px", lineHeight: 1.7 }}>{msg}</p>}
            <button
              onClick={join}
              disabled={phase === "joining"}
              style={{ width: "100%", background: `linear-gradient(135deg,${GRAPE},#FF6B8A)`, color: "#fff", border: "none", borderRadius: 14, padding: "14px", fontSize: 16, fontWeight: 800, fontFamily: "inherit", cursor: phase === "joining" ? "wait" : "pointer", opacity: phase === "joining" ? .7 : 1 }}
            >
              {phase === "joining" ? "מצטרפים…" : "הצטרפות לארגון"}
            </button>
          </>
        )}

        {phase === "joined" && (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 10px" }}>הצטרפתם ✓</h1>
            <p style={{ color: MUTED, fontSize: 14.5, margin: 0 }}>מעבירים אתכם ללוח…</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<div dir="rtl" style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F4F3FB", color: "#7C7A93" }}>טוען…</div>}>
      <JoinContent />
    </Suspense>
  );
}
