"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getMondayStatus } from "@/lib/api-client";

const PURPLE = "#6C4CF1";
const PURPLE2 = "#8A6BFF";

type Step = "welcome" | "connect" | "waking" | "choose";
interface BoardOpt { id: string; name: string; items: number; description: string; }

export default function WelcomePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  /* Is the paste-a-token route open on this deployment? Only the server knows,
     and on a public URL the answer is no — /api/connect replies 403. This page
     used to walk everyone into that refusal, so it asks first and sends them
     down OAuth instead. Starts closed and stays closed on any failed answer:
     the safe default is the one that works for every visitor. */
  const [pasteAllowed, setPasteAllowed] = useState(false);
  useEffect(() => {
    let live = true;
    getMondayStatus()
      .then((st) => { if (live) setPasteAllowed(st.personalToken === true); })
      .catch(() => { if (live) setPasteAllowed(false); });
    return () => { live = false; };
  }, []);

  const begin = () => {
    if (pasteAllowed) { setStep("connect"); return; }
    window.location.href = "/api/monday-oauth/authorize?return_to=/app";
  };

  async function connect() {
    if (token.trim().length < 20) { setErr("הדביקו טוקן תקין מ-Monday"); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "החיבור נכשל"); setBusy(false); return; }
      setAccount(data.account);
      setStep("waking");
    } catch {
      setErr("לא הצלחנו להתחבר לשרת"); setBusy(false);
    }
  }

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: "#F6F7FA", fontFamily: "Rubik, Assistant, Heebo, system-ui, sans-serif", color: "#1D2130", display: "grid", placeItems: "center", padding: 24, position: "relative", overflow: "hidden" }}>
      {/* soft background blobs */}
      <div style={{ position: "absolute", width: 380, height: 380, borderRadius: "50%", background: PURPLE, opacity: 0.07, top: -120, insetInlineEnd: -80, filter: "blur(90px)" }} />
      <div style={{ position: "absolute", width: 300, height: 300, borderRadius: "50%", background: PURPLE2, opacity: 0.06, bottom: -100, insetInlineStart: -60, filter: "blur(80px)" }} />

      <div style={{ width: "100%", maxWidth: 460, position: "relative", zIndex: 1 }}>
        {step === "welcome" && <Welcome onNext={begin} />}
        {step === "connect" && <Connect token={token} setToken={setToken} onConnect={connect} busy={busy} err={err} onBack={() => setStep("welcome")} />}
        {step === "waking" && <Waking account={account} onDone={() => setStep("choose")} />}
        {step === "choose" && <ChooseBoards onDone={() => router.push("/snapshot")} />}
      </div>
    </div>
  );
}

function Logo({ size = 60 }: { size?: number }) {
  return <div style={{ width: size, height: size, borderRadius: size * 0.3, background: `linear-gradient(140deg, ${PURPLE}, ${PURPLE2})`, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: size * 0.46, margin: "0 auto", boxShadow: `0 12px 30px -8px ${PURPLE}` }}>A</div>;
}

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ textAlign: "center", animation: "fade .4s both" }}>
      <Logo />
      <h1 style={{ fontSize: 34, fontWeight: 800, margin: "20px 0 6px", letterSpacing: "-0.02em" }}>
        ברוכים הבאים ל-Any<span style={{ color: PURPLE }}>Day</span>
      </h1>
      <p style={{ fontSize: 16, color: "#6B7385", lineHeight: 1.6, margin: "0 auto 32px", maxWidth: "36ch" }}>
        מדברים עם ה-Monday של הארגון בשפה רגילה. שאלות, ניתוחים ואוטומציות — הכל במקום אחד.
      </p>
      <div style={{ background: "#fff", border: "1px solid #ECEDF3", borderRadius: 22, padding: "26px 28px", boxShadow: "0 12px 40px -14px rgba(70,55,140,.18)", textAlign: "right" }}>
        {[
          ["📊", "שאלו על הבורדים", "וקבלו ניתוח, לא טבלה"],
          ["⚡", "בנו אוטומציות", "בעברית, בלי נוסחאות"],
        ].map(([ic, t, s]) => (
          <div key={t} style={{ display: "flex", alignItems: "center", gap: 13, padding: "10px 0" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "#EFEBFE", display: "grid", placeItems: "center", fontSize: 19, flexShrink: 0 }}>{ic}</div>
            <div><div style={{ fontSize: 14.5, fontWeight: 700 }}>{t}</div><div style={{ fontSize: 12.5, color: "#8489A0" }}>{s}</div></div>
          </div>
        ))}
        <button onClick={onNext} style={btnPrimary}>חברו את ה-Monday שלכם →</button>
      </div>
      {/* ההבטחה הזו הפכה נכונה רק אחרי B-3: כל פעולת AI עוברת מסך אישור,
          וכל כתיבה אחרת (עריכה, ארכוב, אוטומציה) יוצאת מלחיצה מפורשת שלכם. */}
      <p style={{ fontSize: 12, color: "#AEB3C6", marginTop: 18 }}>🔒 קוראים כדי להציג; כותבים רק פעולות שאתם יוזמים ומאשרים · ניתן לנתק בכל רגע ממונדיי</p>
      <style>{fadeCss}</style>
    </div>
  );
}

function Connect({ token, setToken, onConnect, busy, err, onBack }: {
  token: string; setToken: (v: string) => void; onConnect: () => void; busy: boolean; err: string | null; onBack: () => void;
}) {
  return (
    <div style={{ animation: "fade .4s both" }}>
      <Logo size={52} />
      <h2 style={{ fontSize: 24, fontWeight: 800, textAlign: "center", margin: "18px 0 6px" }}>חברו את ה-Monday שלכם</h2>
      <p style={{ fontSize: 14, color: "#6B7385", textAlign: "center", margin: "0 auto 22px", maxWidth: "38ch", lineHeight: 1.6 }}>
        הדביקו Access Token אישי — AnyDay יקרא את הבורדים שלכם ויבנה את תמונת המצב.
      </p>
      <div style={{ background: "#fff", border: "1px solid #ECEDF3", borderRadius: 22, padding: "24px 26px", boxShadow: "0 12px 40px -14px rgba(70,55,140,.18)" }}>
        <textarea
          value={token} onChange={(e) => setToken(e.target.value)}
          placeholder="eyJhbGciOiJIUzI1NiJ9..."
          dir="ltr"
          style={{ width: "100%", minHeight: 80, resize: "none", background: "#F3F4F9", border: "1px solid #E0E2EC", borderRadius: 13, padding: "12px 14px", fontSize: 13, fontFamily: "monospace", outline: "none", color: "#1D2130", textAlign: "left" }}
        />
        {err && <p style={{ color: "#E5484D", fontSize: 13, fontWeight: 600, margin: "10px 0 0" }}>{err}</p>}
        <button onClick={onConnect} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}>
          {busy ? "מתחבר..." : "חברו והמשיכו →"}
        </button>
        <details style={{ marginTop: 14 }}>
          <summary style={{ fontSize: 12.5, color: PURPLE, cursor: "pointer", fontWeight: 600 }}>איפה משיגים טוקן?</summary>
          <ol style={{ fontSize: 12.5, color: "#6B7385", lineHeight: 1.8, margin: "8px 0 0", paddingInlineStart: 18 }}>
            <li>ב-Monday: לחצו על תמונת הפרופיל → <b>Developers</b></li>
            <li>בתפריט → <b>My Access Tokens</b></li>
            <li>לחצו <b>Show</b> והעתיקו</li>
          </ol>
        </details>
      </div>
      <button onClick={onBack} style={{ display: "block", margin: "16px auto 0", background: "none", border: "none", color: "#8489A0", fontSize: 13, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>חזרה</button>
      <style>{fadeCss}</style>
    </div>
  );
}

function Waking({ account, onDone }: { account: string | null; onDone: () => void }) {
  const steps = [
    "מתחבר לחשבון Monday...",
    "קורא את הבורדים שלכם...",
    "מזהה מבנה: פריטים, סטטוסים, תאריכים ואחראים...",
    "בונה את תמונת המצב...",
  ];
  const [i, setI] = useState(0);
  useEffect(() => {
    if (i < steps.length) { const t = setTimeout(() => setI(i + 1), 850); return () => clearTimeout(t); }
    const t = setTimeout(onDone, 700); return () => clearTimeout(t);
  }, [i]);

  return (
    <div style={{ textAlign: "center", animation: "fade .4s both" }}>
      <div style={{ position: "relative", width: 90, height: 90, margin: "0 auto 24px" }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 27, background: `linear-gradient(140deg, ${PURPLE}, ${PURPLE2})`, display: "grid", placeItems: "center", color: "#fff", fontWeight: 800, fontSize: 42, boxShadow: `0 16px 40px -10px ${PURPLE}`, animation: "pulse 1.6s ease-in-out infinite" }}>A</div>
      </div>
      <h2 style={{ fontSize: 23, fontWeight: 800, margin: "0 0 6px" }}>המערכת מתעוררת</h2>
      {account && <p style={{ fontSize: 14, color: "#6B7385", margin: "0 0 26px" }}>מחובר ל-<b>{account}</b></p>}
      <div style={{ background: "#fff", border: "1px solid #ECEDF3", borderRadius: 20, padding: "20px 24px", boxShadow: "0 12px 40px -14px rgba(70,55,140,.18)", textAlign: "right", maxWidth: 360, margin: "0 auto" }}>
        {steps.map((s, idx) => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", opacity: idx <= i ? 1 : 0.35, transition: "opacity .3s" }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: idx < i ? "#16B981" : idx === i ? PURPLE : "#ECEDF3", display: "grid", placeItems: "center", flexShrink: 0 }}>
              {idx < i ? <span style={{ color: "#fff", fontSize: 13 }}>✓</span> : idx === i ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff", animation: "blink 1s infinite" }} /> : null}
            </div>
            <span style={{ fontSize: 13.5, fontWeight: idx === i ? 700 : 500 }}>{s}</span>
          </div>
        ))}
      </div>
      <style>{`${fadeCss}
        @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  );
}

function ChooseBoards({ onDone }: { onDone: () => void }) {
  const [boards, setBoards] = useState<BoardOpt[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const MAX = 2;

  useEffect(() => {
    fetch("/api/boards", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setErr(d.error);
        else { setBoards(d.boards || []); setSel((d.selected || []).slice(0, MAX)); }
      })
      .catch(() => setErr("לא הצלחנו לקרוא בורדים"))
      .finally(() => setLoading(false));
  }, []);

  function toggle(id: string) {
    setSel((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < MAX ? [...cur, id] : cur);
  }
  async function save() {
    if (!sel.length) { setErr("בחרו לפחות בורד אחד"); return; }
    setBusy(true); setErr(null);
    try {
      await fetch("/api/boards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boardIds: sel }) });
      onDone();
    } catch { setErr("שמירה נכשלה"); setBusy(false); }
  }

  return (
    <div style={{ animation: "fade .4s both" }}>
      <Logo size={48} />
      <h2 style={{ fontSize: 23, fontWeight: 800, textAlign: "center", margin: "16px 0 5px" }}>על אילו בורדים נתמקד?</h2>
      <p style={{ fontSize: 14, color: "#6B7385", textAlign: "center", margin: "0 auto 20px", maxWidth: "36ch", lineHeight: 1.6 }}>
        בחרו עד <b>{MAX} בורדים</b> שהכי חשובים לכם — AnyDay יתמקד בהם. תמיד אפשר לשנות אחר כך.
      </p>
      <div style={{ background: "#fff", border: "1px solid #ECEDF3", borderRadius: 22, padding: "16px 18px", boxShadow: "0 12px 40px -14px rgba(70,55,140,.18)", maxHeight: 380, overflowY: "auto" }}>
        {loading && <p style={{ textAlign: "center", color: "#8489A0", fontSize: 14, padding: 20 }}>קורא את הבורדים שלכם...</p>}
        {err && !loading && <p style={{ color: "#E5484D", fontSize: 13.5, fontWeight: 600, textAlign: "center", padding: 12 }}>{err}</p>}
        {!loading && boards.map((b) => {
          const on = sel.includes(b.id);
          const disabled = !on && sel.length >= MAX;
          return (
            <button key={b.id} onClick={() => toggle(b.id)} disabled={disabled}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 13px", borderRadius: 13, border: `1.5px solid ${on ? PURPLE : "#ECEDF3"}`, background: on ? "#EFEBFE" : "#fff", marginBottom: 8, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, textAlign: "right", fontFamily: "inherit", transition: "all .15s" }}>
              <div style={{ width: 22, height: 22, borderRadius: 7, border: `2px solid ${on ? PURPLE : "#D3D9E6"}`, background: on ? PURPLE : "transparent", display: "grid", placeItems: "center", flexShrink: 0 }}>
                {on && <span style={{ color: "#fff", fontSize: 13 }}>✓</span>}
              </div>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: "#F3F4F9", display: "grid", placeItems: "center", fontSize: 16, flexShrink: 0 }}>📋</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.name}</div>
                <div style={{ fontSize: 12, color: "#8489A0" }}>{b.items} פריטים</div>
              </div>
            </button>
          );
        })}
      </div>
      <button onClick={save} disabled={busy || !sel.length} style={{ ...btnPrimary, opacity: (busy || !sel.length) ? 0.5 : 1, cursor: (busy || !sel.length) ? "not-allowed" : "pointer" }}>
        {busy ? "שומר..." : sel.length ? `המשיכו עם ${sel.length} בורדים →` : "בחרו בורד להמשך"}
      </button>
      <style>{fadeCss}</style>
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  width: "100%", marginTop: 18, background: PURPLE, color: "#fff", border: "none",
  borderRadius: 14, padding: "14px 20px", fontSize: 15.5, fontWeight: 700, cursor: "pointer",
  fontFamily: "inherit", boxShadow: `0 10px 24px -8px ${PURPLE}`,
};
const fadeCss = `@keyframes fade{from{opacity:0;transform:translateY(8px)}}`;
