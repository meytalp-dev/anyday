"use client";

/**
 * מסך הצוות.
 *
 * The invite result puts the LINK on screen and says plainly whether the email
 * went out, because on this deployment it usually cannot: anyday.co.il has no
 * SPF or DKIM records, so Resend will not deliver to a stranger. An admin who
 * was told "invitation sent" and whose colleague never received anything would
 * blame the colleague. Handing over a link they can paste into whatever they
 * already use is both honest and, for a team of four, faster.
 */

import { useCallback, useEffect, useState } from "react";
import { ROLE_DESCRIPTION, ROLE_LABEL, ROLES, type Role } from "@/lib/roles";

const GRAPE = "#6C4CF1";
const INK = "#1B1830";
const MUTED = "#7C7A93";
const LINE = "#ECEBF5";
const CARD: React.CSSProperties = {
  background: "#fff", border: `1px solid ${LINE}`, borderRadius: 18, padding: "20px 22px",
};

interface Member { userId: string; email: string; role: string; roleLabel: string; isYou: boolean }
interface Invite { id: string; email: string; role: string; expired: boolean }

export default function TeamPage() {
  const [orgName, setOrgName] = useState("");
  const [youAdmin, setYouAdmin] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ link: string; emailed: boolean; email: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    // No setState before the first await: every path below states its own
    // error, so clearing it up here only cost a synchronous render.
    try {
      const mRes = await fetch("/api/org/members", { cache: "no-store" });
      const m = await mRes.json().catch(() => ({}));
      if (!mRes.ok) { setErr(m.error ?? "לא הצלחנו לטעון את הצוות"); setLoading(false); return; }
      setOrgName(m.orgName ?? "");
      setErr("");
      setYouAdmin(m.you?.role === "admin");
      setMembers(m.members ?? []);

      if (m.you?.role === "admin") {
        const iRes = await fetch("/api/org/invites", { cache: "no-store" });
        const i = await iRes.json().catch(() => ({}));
        // A missing table is a setup step, not a crash: say it once, here.
        if (!iRes.ok) setErr(i.error ?? "");
        else setInvites(i.invites ?? []);
      }
    } catch {
      setErr("לא הצלחנו לטעון את הצוות");
    }
    setLoading(false);
  }, []);

  // The rule cannot see past the async boundary: `load` awaits the fetch
  // before it touches any state, so there is no synchronous set here and no
  // cascading render to prevent. Fetch-on-mount plus refetch-after-mutation is
  // the whole reason `load` is a callback rather than inlined.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function invite() {
    setBusy(true); setErr(""); setIssued(null); setCopied(false);
    try {
      const res = await fetch("/api/org/invites", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(body.error ?? "ההזמנה נכשלה"); setBusy(false); return; }
      setIssued({ link: body.link, emailed: body.emailed, email: body.email });
      setEmail("");
      await load();
    } catch { setErr("ההזמנה נכשלה"); }
    setBusy(false);
  }

  async function changeRole(userId: string, next: Role) {
    const res = await fetch("/api/org/members", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role: next }),
    });
    if (!res.ok) { const b = await res.json().catch(() => ({})); setErr(b.error ?? "העדכון נכשל"); return; }
    setErr(""); await load();
  }

  async function remove(userId: string, who: string) {
    if (!confirm(`להסיר את ${who} מהארגון?`)) return;
    const res = await fetch(`/api/org/members?userId=${encodeURIComponent(userId)}`, { method: "DELETE" });
    if (!res.ok) { const b = await res.json().catch(() => ({})); setErr(b.error ?? "ההסרה נכשלה"); return; }
    setErr(""); await load();
  }

  async function revoke(id: string) {
    const res = await fetch(`/api/org/invites/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) { const b = await res.json().catch(() => ({})); setErr(b.error ?? "הביטול נכשל"); return; }
    setErr(""); await load();
  }

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: "#F4F3FB", color: INK, fontFamily: "Rubik, Assistant, Heebo, system-ui, sans-serif" }}>
      <header style={{ background: "#fff", borderBottom: `1px solid ${LINE}`, padding: "0 18px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", height: 58, display: "flex", alignItems: "center", gap: 12 }}>
          <a href="/app" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", color: INK }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: `linear-gradient(135deg,${GRAPE},#FF2D87)`, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 16 }}>A</div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>Any<span style={{ color: GRAPE }}>Day</span></div>
          </a>
          <span style={{ fontSize: 12.5, color: MUTED, fontWeight: 600 }}>הצוות</span>
          <a href="/app" style={{ marginInlineStart: "auto", fontSize: 13, color: GRAPE, textDecoration: "none" }}>← ללוח</a>
        </div>
      </header>

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "26px 18px 70px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 4px" }}>הצוות של {orgName}</h1>
        <p style={{ fontSize: 13.5, color: MUTED, margin: "0 0 20px" }}>
          כל מי שנמצא כאן רואה את אותם לוחות. התפקיד קובע מה מותר לו לשנות.
        </p>

        {err && (
          <div style={{ ...CARD, borderColor: "#F3B7BE", background: "#FFF5F6", marginBottom: 16, fontSize: 13.5, lineHeight: 1.7 }}>{err}</div>
        )}

        {loading ? <p style={{ color: MUTED }}>טוען…</p> : (
          <>
            <section style={{ ...CARD, marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, margin: "0 0 12px" }}>חברים</h2>
              {members.map((m) => (
                <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${LINE}`, flexWrap: "wrap" }}>
                  <span style={{ flex: 1, minWidth: 160, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {m.email}{m.isYou && <span style={{ color: MUTED, fontSize: 12 }}> · אתם</span>}
                  </span>
                  {youAdmin ? (
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m.userId, e.target.value as Role)}
                      style={{ padding: "6px 9px", borderRadius: 9, border: `1.5px solid ${LINE}`, fontSize: 12.5, fontFamily: "inherit", background: "#FAF9FE", color: INK }}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  ) : (
                    <span style={{ fontSize: 12.5, color: MUTED }}>{m.roleLabel}</span>
                  )}
                  {youAdmin && !m.isYou && (
                    <button onClick={() => remove(m.userId, m.email)} style={{ border: "none", background: "#F7F6FC", color: MUTED, borderRadius: 9, padding: "6px 10px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>הסרה</button>
                  )}
                </div>
              ))}
            </section>

            {youAdmin && (
              <section style={{ ...CARD, marginBottom: 16 }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, margin: "0 0 4px" }}>הזמנת אדם לארגון</h2>
                <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 14px", lineHeight: 1.7 }}>
                  {ROLE_DESCRIPTION[role]}
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr"
                    placeholder="name@org.com" type="email"
                    style={{ flex: 1, minWidth: 190, padding: "10px 12px", borderRadius: 11, border: `1.5px solid ${LINE}`, fontSize: 13.5, fontFamily: "inherit", background: "#FAF9FE", color: INK, textAlign: "left" }}
                  />
                  <select value={role} onChange={(e) => setRole(e.target.value as Role)}
                    style={{ padding: "10px 12px", borderRadius: 11, border: `1.5px solid ${LINE}`, fontSize: 13, fontFamily: "inherit", background: "#FAF9FE", color: INK }}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  <button onClick={invite} disabled={busy || !email.trim()}
                    style={{ background: GRAPE, color: "#fff", border: "none", borderRadius: 11, padding: "10px 20px", fontSize: 13.5, fontWeight: 800, fontFamily: "inherit", cursor: busy || !email.trim() ? "not-allowed" : "pointer", opacity: busy || !email.trim() ? .5 : 1 }}>
                    {busy ? "יוצרים…" : "יצירת הזמנה"}
                  </button>
                </div>

                {issued && (
                  <div style={{ marginTop: 14, padding: "13px 15px", background: "#F4F2FE", borderRadius: 13, border: `1px solid ${GRAPE}33` }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                      {issued.emailed
                        ? `נשלח מייל ל-${issued.email}. אפשר גם לשלוח את הקישור ישירות:`
                        : `ההזמנה מוכנה. המייל לא יצא — שלחו את הקישור בעצמכם:`}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <input readOnly value={issued.link} dir="ltr" onFocus={(e) => e.currentTarget.select()}
                        style={{ flex: 1, minWidth: 200, padding: "8px 10px", borderRadius: 9, border: `1px solid ${LINE}`, background: "#fff", fontSize: 12, fontFamily: "monospace", color: INK, textAlign: "left" }} />
                      <button
                        onClick={() => { void navigator.clipboard.writeText(issued.link).then(() => setCopied(true)); }}
                        style={{ background: "#fff", border: `1.5px solid ${GRAPE}`, color: GRAPE, borderRadius: 9, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                        {copied ? "הועתק ✓" : "העתקה"}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {youAdmin && invites.length > 0 && (
              <section style={CARD}>
                <h2 style={{ fontSize: 16, fontWeight: 800, margin: "0 0 12px" }}>הזמנות ממתינות</h2>
                {invites.map((i) => (
                  <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${LINE}`, flexWrap: "wrap" }}>
                    <span style={{ flex: 1, minWidth: 150, fontSize: 13.5 }} dir="ltr">{i.email}</span>
                    <span style={{ fontSize: 12, color: i.expired ? "#C2410C" : MUTED }}>
                      {i.expired ? "פגה" : ROLE_LABEL[i.role as Role] ?? i.role}
                    </span>
                    <button onClick={() => revoke(i.id)} style={{ border: "none", background: "#F7F6FC", color: MUTED, borderRadius: 9, padding: "6px 10px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>ביטול</button>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
