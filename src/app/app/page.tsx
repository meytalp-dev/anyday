"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import * as BI from "@/lib/board-intelligence";
import { ModeShell, type Mode, type ShellTab } from "@/components/ui/ModeShell";
import { loadBoard, disconnectMonday, getMondayStatus } from "@/lib/api-client";
import DataEditPanel from "@/components/board/DataEditPanel";
import { AutomationsPanel } from "@/components/board/AutomationsPanel";
import { AlertsPanel, ImpactPanel, ReportPanel } from "@/components/board/BoardDashboard";
import { SmartBuilder } from "@/components/builder/SmartBuilder";
import type { MondayBoard, MondayItem } from "@/types";
import { parseDelimited, headRow, normKey, looksLikeHeader } from "@/lib/sheet-to-board";
import { useUser } from "@/lib/use-user";
import { examplePurposes, type BoardProfile } from "@/lib/board-profile";

/* ===== "לוח חי" palette — colorful, energetic, NOT flat purple ===== */
const C = {
  bg: "#F4F3FB", panel: "#FFFFFF", ink: "#1B1830", muted: "#7C7A93",
  grape: "#6C4CF1", grapeL: "#EEEBFE",
  coral: "#FF6B8A", coralL: "#FFEBF0",
  teal: "#12C7A8", tealL: "#DFF7F2",
  amber: "#FFAE34", amberL: "#FFF1DC",
  sky: "#3E9BFF", skyL: "#E4F1FF",
  lime: "#84D65A", limeL: "#ECF9E1",
};
const PALETTE = [
  { fg: C.grape, bg: C.grapeL }, { fg: C.coral, bg: C.coralL }, { fg: C.teal, bg: C.tealL },
  { fg: C.amber, bg: C.amberL }, { fg: C.sky, bg: C.skyL }, { fg: C.lime, bg: C.limeL },
];
const pick = (i: number) => PALETTE[i % PALETTE.length];
/* A status value is painted by its TONE, which arrives from the server. The
   server derives that tone from the colour the Monday board itself gave the
   label (see board-intelligence), so this screen recognises no word at all -
   a board in Hebrew, Arabic or English colours identically. */
type Tone = "risk" | "progress" | "done" | "neutral";
type ToneMap = Record<string, string>;
const TONE_STYLE: Record<Tone, { fg: string; bg: string }> = {
  done: { fg: "#0B8F76", bg: C.tealL },
  risk: { fg: "#D63A5C", bg: C.coralL },
  progress: { fg: "#C77A00", bg: C.amberL },
  neutral: { fg: C.muted, bg: "#F0EFF6" },
};
const toneStyle = (t?: string) => TONE_STYLE[t as Tone] || TONE_STYLE.neutral;

/**
 * The ONE breakpoint of /app: below 900px the two-column shell folds to one.
 * Everything in this page is styled inline, so a media query cannot reach it —
 * this hook is the media query. Initial value false (SSR has no window);
 * hydration corrects it on the first paint of a phone.
 */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return narrow;
}

/* The eight tab names are locked by Meytal (28.8.2026) — see the approved
   mockup in anyday-ops. Do not reword them. "AnyDay" is the product name on the
   roof only; the chat tab is called צ׳אט־פקודות. */
const TABS: Record<Mode, ShellTab[]> = {
  manage: [
    { id: "dash", label: "לוח חי" },
    { id: "people", label: "משתתפים" },
    { id: "insights", label: "תובנות" },
  ],
  act: [
    { id: "chat", label: "צ׳אט־פקודות" },
    { id: "bulk", label: "עריכה קבוצתית" },
    { id: "autos", label: "אוטומציות" },
    { id: "reports", label: "דוחות" },
    { id: "build", label: "בניית בורד" },
  ],
};
const readMode = (v: string | null): Mode => (v === "act" ? "act" : "manage");
const readTab = (m: Mode, v: string | null): string =>
  TABS[m].some((t) => t.id === v) ? (v as string) : TABS[m][0].id;
interface Widget { kind: string; title: string; source: string; data: unknown; }
interface KPI { icon: string; n: number; label: string; tone: string; }
interface PField { colId: string; title: string; type: string; text: string }
interface Person { id: string; name: string; boardId: string; boardName: string; status: string; owner: string; date: string; fields: PField[]; }
interface BoardOpt { id: string; name: string; items: number; }
/** A board's real columns, as /api/people reports them (id + title + TYPE). */
interface BoardCol { id: string; title: string; type: string }
interface BoardInfo { id: string; name: string; columns: BoardCol[] }

/** How much of the board the numbers are actually based on (see board-fetch). */
interface Cov { loaded: number; total: number; truncated: boolean; note: string }

/** What GET /api/boards answers with: boards, or an error carried by a status. */
interface BoardsReply { boards?: BoardOpt[]; selected?: string[]; error?: string }
/**
 * Which of /app's entry screens the visitor is owed right now.
 *  checking - the first answer from /api/boards has not arrived yet
 *  open     - there is a Monday connection; the normal screens take over
 *  connect  - no connection: show the connect gate, not an empty picker
 *  error    - something else broke; say so instead of blaming the connection
 */
type GateState =
  | { kind: "checking" }
  | { kind: "open" }
  | { kind: "connect" }
  | { kind: "error"; msg: string };

export default function AppPage() {
  // useSearchParams needs a Suspense boundary for the statically-rendered shell.
  return (
    <Suspense fallback={<Spinner label="טוען..." />}>
      <AppShell />
    </Suspense>
  );
}

/**
 * The shared roof. Two modes live here: "ניהול", where the system shows you what
 * it already worked out, and "פעולות", where you ask it to do something. Both
 * render existing screens unchanged — this component only decides which one is
 * on screen, and keeps that choice in the URL so a view can be linked to.
 */
function AppShell() {
  const params = useSearchParams();
  const [boards, setBoards] = useState<BoardOpt[]>([]);
  const [active, setActive] = useState<string[]>([]);   // boards shown on dashboard
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>(() => readMode(params.get("mode")));
  const [tab, setTab] = useState<string>(() => readTab(readMode(params.get("mode")), params.get("tab")));
  const [chatOpen, setChatOpen] = useState(false);
  /* /app is the front door now, so the answer from /api/boards can no longer be
     dropped on the floor: without a Monday connection it is the ONLY thing that
     knows a gate has to be shown. Kept as "checking" until the first answer, so
     nobody is left staring at a board picker that was never going to fill. */
  const [gate, setGate] = useState<GateState>({ kind: "checking" });
  /* The bubble's chat engine lives here, not inside the bubble, so a section of
     "תובנות" can hand it a question — the same move /workspace made when an
     alert asked the AI what to do. */
  const fabChat = useChat();
  /* מעל early-returns של השער — hook לא נקרא בתנאי לעולם. */
  const narrow = useIsNarrow();
  /* מיתוג הארגון (W1): לוגו+שם על הגג, ופאנל עריכה לאדמין ב-aside. נטען
     פעם אחת; היעדרו (מצב personal, או v6 שטרם רצה) פשוט משאיר את הגג גנרי. */
  const branding = useBranding();

  useEffect(() => {
    fetch("/api/boards", { cache: "no-store" })
      .then(async (r) => ({ status: r.status, body: (await r.json().catch(() => ({}))) as BoardsReply }))
      .then(({ status, body }) => {
        if (body.boards) {
          /* An EMPTY board is still a board. "בניית בורד" creates one that is
             born with zero items, so filtering those out made the tab produce
             something the user could never reach again. Everything is listed;
             the screens say plainly when a board has no records yet. */
          setBoards(body.boards);
          if (body.selected?.length) { setActive(body.selected); setReady(true); }
          setGate({ kind: "open" });
          return;
        }
        /* 401 = nobody signed in yet, 409 = signed in but Monday is not
           connected (or its token expired). Those two, and only those two, are
           answered by the connect gate. The HTTP STATUS decides - never the
           wording of the message, which is free to change or be translated. */
        if (status === 401 || status === 409) { setGate({ kind: "connect" }); return; }
        setGate({ kind: "error", msg: body.error || "לא הצלחנו לטעון את הבורדים." });
      })
      .catch(() => setGate({ kind: "error", msg: "לא הצלחנו לפנות לשרת. בדקו את החיבור לרשת ונסו שוב." }));
  }, []);

  /* Mirror mode+tab into the address bar. replaceState keeps it a client-side
     move: no reload, no new history entry per click, but the URL is shareable. */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    q.set("mode", mode); q.set("tab", tab);
    window.history.replaceState({}, "", `${window.location.pathname}?${q.toString()}`);
  }, [mode, tab]);

  async function begin(ids: string[]) {
    await fetch("/api/boards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boardIds: ids }) });
    setActive(ids); setReady(true);
  }
  async function setActiveBoards(ids: string[]) {
    if (!ids.length) return;
    await fetch("/api/boards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boardIds: ids }) });
    setActive(ids);
  }
  /* Switching mode lands on that mode's first tab — a tab id is only valid
     inside its own mode. */
  function goMode(m: Mode) { setMode(m); setTab(TABS[m][0].id); }
  /* After a disconnect there is no Monday behind the screens any more, so the
     whole session is wound back to the state /api/boards would report on a
     fresh visit: the connect gate T11 built - never a blank screen. */
  function handleDisconnected() {
    setBoards([]); setActive([]); setReady(false); setGate({ kind: "connect" });
  }
  /* Called after "בניית בורד" creates one, so it shows up in the board picker
     without a page reload. */
  async function reloadBoards() {
    const d = await fetch("/api/boards", { cache: "no-store" }).then((r) => r.json());
    /* No items>0 filter here either - a board that was just built is empty by
       definition, and this reload exists precisely to surface it. */
    if (d.boards) setBoards(d.boards as BoardOpt[]);
  }

  if (gate.kind === "checking") return <GateFrame><Spinner label={"בודקים חיבור..."} /></GateFrame>;
  if (gate.kind === "connect") return <ConnectGate />;
  if (gate.kind === "error") return <GateFrame><ErrBox msg={gate.msg} /></GateFrame>;
  if (!ready) return <Onboard boards={boards} onStart={begin} />;

  const activeBoards = boards.filter((b) => active.includes(b.id));
  const activeNames = activeBoards.map((b) => b.name);
  /* Every board on the roof is still empty - the dashboard is not broken, it
     simply has nothing to count yet, and has to say so. */
  const activeAllEmpty = activeBoards.length > 0 && activeBoards.every((b) => b.items === 0);

  return (
    <ModeShell mode={mode} onModeChange={goMode} tabs={TABS[mode]} tab={tab} onTabChange={setTab} branding={branding.b} aside={<ShellAside onDisconnected={handleDisconnected} branding={branding.b} onBrandingChanged={branding.refresh} />}>
      {mode === "manage" ? (
        <>
          {/* מסך צר = טור אחד, והסרגל הופך לכפתור מעל התוכן (B-6): הדיגסט
              נפתח בטלפון, וזה המסך שהוא מוביל אליו. */}
          <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 250px", maxWidth: 1260, margin: "0 auto", gap: 18, padding: narrow ? "14px 14px 90px" : "20px 20px 90px" }}>
            {narrow && <BoardRail boards={boards} active={active} setActive={setActiveBoards} collapsible />}
            <main style={{ minWidth: 0 }}>
              {tab === "dash" && <DashboardsHome names={activeNames} empty={activeAllEmpty} activeBoards={activeBoards} allBoards={boards} activeKey={active.join()} />}
              {tab === "people" && <People />}
              {tab === "insights" && (
                <>
                  <Insights key={active.join()} names={activeNames} />
                  <BoardScans
                    key={`scan-${active.join()}`}
                    boards={boards.filter((b) => active.includes(b.id))}
                    onAskAI={(q) => { setChatOpen(true); void fabChat.send(q); }}
                  />
                </>
              )}
            </main>
            {!narrow && <BoardRail boards={boards} active={active} setActive={setActiveBoards} />}
          </div>
          <ChatFab chat={fabChat} open={chatOpen} setOpen={setChatOpen} tab={tab} names={activeNames} />
        </>
      ) : (
        <ActMode tab={tab} boards={boards} names={activeNames} onBoardsChanged={reloadBoards} />
      )}
    </ModeShell>
  );
}

/* ===== right-hand slot of the top bar =====
   Two things /workspace had and the roof did not: WHICH Monday account you are
   looking at, and a way out of it. The home page promises "אפשר לנתק בלחיצה",
   so the roof has to keep that promise before the old screen can close. */
function ShellAside({ onDisconnected, branding, onBrandingChanged }: {
  onDisconnected: () => void;
  branding: Branding;
  onBrandingChanged: () => void;
}) {
  const synced = useSyncTime();
  const me = useUser();
  const greetName = me?.name || me?.email?.split("@")[0] || null;
  /* Same source /workspace uses - GET /api/monday/status via api-client. No new
     route: the account name is already in that answer. */
  const [account, setAccount] = useState<string | null>(null);
  /* Disconnecting is reversible but surprising, so it is a two-step: the button
     turns into an explicit confirm, and only the second click writes anything. */
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getMondayStatus()
      .then((st) => { if (alive) setAccount(st.accountName ?? null); })
      .catch(() => { /* the name is a nicety - its absence must not break the bar */ });
    return () => { alive = false; };
  }, []);

  async function confirmDisconnect() {
    setBusy(true);
    try { await disconnectMonday(); onDisconnected(); }
    finally { setBusy(false); setAsking(false); }
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }} title={`מסונכרן עם Monday · ${synced}`}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.teal }} />
        <span style={{ fontSize: 10.5, color: "#9E9CB2" }}>מסונכרן {synced}</span>
      </div>
      <div
        style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, maxWidth: 170, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", borderInlineStart: "1px solid #ECEBF5", paddingInlineStart: 12 }}
        title={account ? `מחוברים לחשבון ${account} ב-Monday` : "מחוברים ל-Monday"}
      >
        <span style={{ color: C.teal, marginInlineEnd: 5 }}>●</span>{account || "מחובר ל-Monday"}
      </div>
      {asking ? (
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 11.5, color: C.ink }}>לנתק את Monday?</span>
          <button
            onClick={confirmDisconnect} disabled={busy}
            style={{ border: "none", background: C.coral, color: "#fff", borderRadius: 9, padding: "5px 11px", fontSize: 11.5, fontWeight: 700, cursor: busy ? "wait" : "pointer", fontFamily: "inherit" }}
          >{busy ? "מנתקים…" : "כן, נתקו"}</button>
          <button
            onClick={() => setAsking(false)} disabled={busy}
            style={{ border: "1px solid #E6E4F0", background: "#fff", color: C.muted, borderRadius: 9, padding: "5px 11px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
          >{"ביטול"}</button>
        </div>
      ) : (
        <button
          onClick={() => setAsking(true)}
          title="מנתקים את החיבור ל-Monday. הנתונים ב-Monday לא משתנים, ואפשר להתחבר שוב."
          style={{ border: "1px solid #E6E4F0", background: "#fff", color: C.muted, borderRadius: 9, padding: "5px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
        >{"נתק"}</button>
      )}
      {/* Branding is an org-level setting, so the button exists only for the
          role that may change it — everyone else just sees the logo itself. */}
      {branding.role === "admin" && <BrandingControl branding={branding} onChanged={onBrandingChanged} />}
      {/* The name comes from the signed-in user. It used to be a hardcoded
          "שלום, לירון", which greeted every organization by one developer's
          name. Falls back to a bare greeting rather than guessing. */}
      <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, borderInlineStart: "1px solid #ECEBF5", paddingInlineStart: 12 }}>{greetName ? `שלום, ${greetName}` : "שלום"}</div>
    </>
  );
}

/* ===== org branding (W1): logo + brand colour, admin-only ===== */

interface Branding { orgName: string | null; logoUrl: string | null; brandColor: string | null; role: string | null }
const NO_BRANDING: Branding = { orgName: null, logoUrl: null, brandColor: null, role: null };

/** The org's branding, from /api/org/branding. Its absence never breaks the roof. */
function useBranding(): { b: Branding; refresh: () => void } {
  const [b, setB] = useState<Branding>(NO_BRANDING);
  const refresh = () => {
    fetch("/api/org/branding", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d && !d.error) setB({ orgName: d.orgName ?? null, logoUrl: d.logoUrl ?? null, brandColor: d.brandColor ?? null, role: d.role ?? null });
      })
      .catch(() => { /* branding is a nicety — its absence must not break the shell */ });
  };
  useEffect(refresh, []);
  return { b, refresh };
}

/**
 * A small "מיתוג" button that opens an inline panel: upload a logo, pick a
 * brand colour, remove. Everything posts to /api/org/branding, which is the
 * actual wall (admin check + validation); this is just hands.
 */
function BrandingControl({ branding, onChanged }: { branding: Branding; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function post(form: FormData) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/org/branding", { method: "POST", body: form });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErr(d.error || "השמירה נכשלה");
      else onChanged();
    } catch {
      setErr("לא הצלחנו לפנות לשרת");
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(f: File) {
    const form = new FormData();
    form.set("logo", f);
    await post(form);
  }

  async function saveColor(hex: string) {
    const form = new FormData();
    form.set("brandColor", hex);
    await post(form);
  }

  async function removeLogo() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/org/branding", { method: "DELETE" });
      if (!r.ok) setErr("ההסרה נכשלה");
      else onChanged();
    } finally {
      setBusy(false);
    }
  }

  const btn: React.CSSProperties = { border: "1px solid #E6E4F0", background: "#fff", color: C.muted, borderRadius: 9, padding: "5px 11px", fontSize: 11.5, fontWeight: 600, cursor: busy ? "wait" : "pointer", fontFamily: "inherit" };

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} title="לוגו וצבע של הארגון — מופיעים בלוח ובמייל השבועי" style={btn} aria-expanded={open}>
        מיתוג
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", insetInlineEnd: 0, zIndex: 30, background: "#fff", border: "1px solid #E6E4F0", borderRadius: 14, boxShadow: "0 8px 28px rgba(27,24,48,.12)", padding: 14, width: 230 }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>מיתוג הארגון</div>
          <input
            ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); e.target.value = ""; }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <button onClick={() => fileRef.current?.click()} disabled={busy} style={{ ...btn, textAlign: "right" }}>
              {branding.logoUrl ? "החלפת הלוגו…" : "העלאת לוגו…"}
            </button>
            {branding.logoUrl && (
              <button onClick={() => void removeLogo()} disabled={busy} style={{ ...btn, textAlign: "right", color: C.coral }}>הסרת הלוגו</button>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: C.muted, cursor: "pointer" }}>
              <input
                type="color" value={branding.brandColor || "#5B2BD9"} disabled={busy}
                onChange={(e) => void saveColor(e.target.value)}
                style={{ width: 30, height: 24, border: "1px solid #E6E4F0", borderRadius: 6, padding: 0, background: "none", cursor: "pointer" }}
                aria-label="צבע המותג"
              />
              צבע המותג במייל השבועי
            </label>
          </div>
          <div style={{ fontSize: 10.5, color: "#A9A7BE", marginTop: 8, lineHeight: 1.5 }}>PNG / JPG / WebP עד 512KB. הלוגו מופיע כאן ובמייל הדיגסט.</div>
          {err && <div style={{ fontSize: 11, color: C.coral, marginTop: 6 }}>{err}</div>}
        </div>
      )}
    </div>
  );
}

function useSyncTime() {
  const [t, setT] = useState("עכשיו");
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => { const s = Math.floor((Date.now() - start) / 1000); setT(s < 5 ? "עכשיו" : s < 60 ? `לפני ${s} ש׳` : `לפני ${Math.floor(s / 60)} דק׳`); }, 5000);
    return () => clearInterval(id);
  }, []);
  return t;
}

/* ===== board rail (right) ===== */
function BoardRail({ boards, active, setActive, collapsible }: { boards: BoardOpt[]; active: string[]; setActive: (ids: string[]) => void; collapsible?: boolean }) {
  const [q, setQ] = useState("");
  const shown = boards.filter((b) => b.name.includes(q));
  function toggle(id: string) {
    const next = active.includes(id) ? active.filter((x) => x !== id) : active.length < 2 ? [...active, id] : [active[1], id];
    setActive(next);
  }

  /* במסך צר הסרגל לא יכול לשבת בצד — הוא היה דוחס את התוכן לפס. הוא הופך
     ל-<details>: שורת כפתור שמראה מה נבחר, ונפתחת רק כשרוצים להחליף. */
  if (collapsible) {
    const activeNames = boards.filter((b) => active.includes(b.id)).map((b) => b.name);
    return (
      <details style={{ background: C.panel, border: `1px solid #ECEBF5`, borderRadius: 16 }}>
        <summary style={{ listStyle: "none", cursor: "pointer", padding: "12px 14px", display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
          <span aria-hidden style={{ fontSize: 11, color: C.muted }}>▾</span>
          בורדים על הלוח
          <span style={{ fontWeight: 500, color: C.muted, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {activeNames.length ? `· ${activeNames.join(" + ")}` : "· לא נבחרו"}
          </span>
        </summary>
        <div style={{ padding: "0 14px 14px" }}>
          <RailBody q={q} setQ={setQ} shown={shown} active={active} toggle={toggle} />
        </div>
      </details>
    );
  }

  return (
    <aside style={{ position: "sticky", top: 78, alignSelf: "start", background: C.panel, border: `1px solid #ECEBF5`, borderRadius: 20, padding: 14, maxHeight: "calc(100vh - 100px)", overflowY: "auto" }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".05em", color: C.muted, marginBottom: 4 }}>בורדים על הלוח</div>
      <div style={{ fontSize: 11, color: "#A9A7BE", marginBottom: 10 }}>סמנו עד 2 · הלוח מתעדכן מיד</div>
      <RailBody q={q} setQ={setQ} shown={shown} active={active} toggle={toggle} />
    </aside>
  );
}

/** תוכן הסרגל — משותף לגרסת הצד ולגרסת הכפתור, כדי שלא יהיו שתי אמיתות. */
function RailBody({ q, setQ, shown, active, toggle }: {
  q: string; setQ: (v: string) => void; shown: BoardOpt[]; active: string[]; toggle: (id: string) => void;
}) {
  return (
    <>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש..." style={{ width: "100%", padding: "8px 11px", borderRadius: 10, border: "1px solid #E6E4F0", fontSize: 12.5, outline: "none", fontFamily: "inherit", marginBottom: 10 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {shown.slice(0, 40).map((b, i) => {
          const on = active.includes(b.id); const c = pick(i);
          return (
            <button key={b.id} onClick={() => toggle(b.id)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 12, border: `1.5px solid ${on ? c.fg : "transparent"}`, background: on ? c.bg : "#F7F6FC", cursor: "pointer", textAlign: "right", fontFamily: "inherit", transition: "all .12s" }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: c.fg, flexShrink: 0, opacity: on ? 1 : .3 }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: on ? 700 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.name}</span>
              <span style={{ fontSize: 10.5, color: C.muted, fontVariantNumeric: "tabular-nums" }}>{b.items}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ===== the connect gate =====
   State 3, the one /app never had: /api/boards answered "not connected".
   Both ways into Monday are offered here - the OAuth flow, and /welcome for
   whoever pastes a personal token - because /welcome is still the only route
   for a personal token and must not be cut off. */
function GateFrame({ children }: { children: ReactNode }) {
  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: C.bg, fontFamily: "Rubik, Assistant, Heebo, system-ui, sans-serif", color: C.ink, display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 520 }}>{children}</div>
    </div>
  );
}

function ConnectGate() {
  return (
    <GateFrame>
      <div style={{ background: C.panel, borderRadius: 22, padding: "38px 30px 30px", textAlign: "center", boxShadow: "0 18px 50px -28px rgba(60,50,120,.45)" }}>
        <div style={{ width: 56, height: 56, borderRadius: 18, background: `linear-gradient(135deg,${C.grape},${C.coral})`, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 26, margin: "0 auto 16px" }}>A</div>
        <h1 style={{ fontSize: 24.5, fontWeight: 800, margin: "0 0 9px", lineHeight: 1.4 }}>{"מחברים את Monday, ומקבלים לוח"}</h1>
        <p style={{ fontSize: 14.5, color: C.muted, margin: "0 0 26px", lineHeight: 1.75 }}>{"AnyDay קוראת את הבורדים שכבר יש לכם ובונה מהם לוח קריא. אפס הגדרות."}</p>
        <button
          onClick={() => { window.location.href = "/api/monday-oauth/authorize?return_to=/app"; }}
          style={{ width: "100%", background: `linear-gradient(135deg,${C.grape},${C.coral})`, color: "#fff", border: "none", borderRadius: 15, padding: "15px", fontSize: 16.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}
        >{"התחברו ל-Monday"}</button>
        <a
          href="/welcome"
          style={{ display: "block", marginTop: 16, fontSize: 13, color: C.muted, textDecoration: "underline", fontFamily: "inherit" }}
        >{"יש לכם טוקן אישי? התחברו כאן"}</a>
      </div>
    </GateFrame>
  );
}

/* ===== onboarding ===== */
function Onboard({ boards, onStart }: { boards: BoardOpt[]; onStart: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>([]); const [q, setQ] = useState("");
  const shown = boards.filter((b) => b.name.includes(q));
  const toggle = (id: string) => setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : s.length < 2 ? [...s, id] : s);
  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: C.bg, fontFamily: "Rubik, Assistant, Heebo, system-ui, sans-serif", color: C.ink, display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 620 }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div style={{ width: 56, height: 56, borderRadius: 18, background: `linear-gradient(135deg,${C.grape},${C.coral})`, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 26, margin: "0 auto 14px" }}>A</div>
          <h1 style={{ fontSize: 25, fontWeight: 800, margin: "0 0 5px" }}>על אילו בורדים נבנה את הלוח?</h1>
          <p style={{ fontSize: 14, color: C.muted, margin: 0 }}>בחרו עד 2 — נתחיל, ותמיד אפשר להחליף מהסרגל.</p>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש בורד..." style={{ width: "100%", padding: "12px 15px", borderRadius: 13, border: "1px solid #E6E4F0", fontSize: 14, marginBottom: 12, outline: "none", fontFamily: "inherit" }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {shown.slice(0, 30).map((b, i) => { const on = sel.includes(b.id), dis = !on && sel.length >= 2, c = pick(i);
            return <button key={b.id} onClick={() => toggle(b.id)} disabled={dis} style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 14px", borderRadius: 15, border: `2px solid ${on ? c.fg : "transparent"}`, background: on ? c.bg : C.panel, cursor: dis ? "not-allowed" : "pointer", opacity: dis ? .4 : 1, textAlign: "right", fontFamily: "inherit", boxShadow: on ? `0 8px 20px -10px ${c.fg}` : "0 2px 8px rgba(60,50,120,.05)" }}>
              <span style={{ width: 30, height: 30, borderRadius: 10, background: c.bg, color: c.fg, display: "grid", placeItems: "center", fontSize: 15, flexShrink: 0 }}>📋</span>
              <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.name}</span><span style={{ fontSize: 11.5, color: C.muted }}>{b.items ? `${b.items} פריטים` : "עדיין בלי רשומות"}</span></span>
            </button>;
          })}
        </div>
        <button onClick={() => onStart(sel)} disabled={!sel.length} style={{ width: "100%", marginTop: 18, background: `linear-gradient(135deg,${C.grape},${C.coral})`, color: "#fff", border: "none", borderRadius: 15, padding: "15px", fontSize: 16, fontWeight: 800, cursor: sel.length ? "pointer" : "not-allowed", opacity: sel.length ? 1 : .5, fontFamily: "inherit" }}>{sel.length ? "בנו לי את הלוח →" : "בחרו בורד"}</button>
      </div>
    </div>
  );
}

/* ===== ImpactMap — the constellation "לוח חי" ===== */
interface Dot { id: string; name: string; cluster: string; status: string; updatedAt: string; fields: { title: string; text: string }[]; x?: number; y?: number; c?: string; }
interface CBoard { boardId: string; boardName: string; entity: string; clusterTitle: string; statusTitle: string; clusters: { name: string; n: number }[]; dots: Dot[]; }
const DOT_COLORS = ["#8A6BFF", "#4FA9FF", "#12C7A8", "#FFAE34", "#FF6B8A", "#84D65A"];
/** Dot colour from the server-derived tone - never from the status text. */
function statusDotColor(tone?: string) { return tone === "risk" ? "#FF5470" : tone === "done" ? "#12C7A8" : null; }

// NOTE: this component is not mounted anywhere today. When it is wired back in,
// its caller must hand it the tone map (GET /api/dashboard?meta=1), exactly as
// People does - /api/constellation does not carry tones of its own.
function ImpactMap({ names, tones }: { names: string[]; tones: ToneMap }) {
  const [data, setData] = useState<CBoard[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Dot | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<Dot[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setData(null);
    fetch("/api/constellation", { cache: "no-store" }).then((r) => r.json()).then((d) => d.error ? setErr(d.error) : setData(d.boards)).catch(() => setErr("שגיאה"));
  }, []);

  // layout + draw the constellation
  useEffect(() => {
    if (!data || !canvasRef.current || !wrapRef.current) return;
    const canvas = canvasRef.current, wrap = wrapRef.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = wrap.clientWidth, H = 560;
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d")!; ctx.scale(dpr, dpr);

    // Build clusters from the first board (or merge). Position clusters on a grid.
    const board = data[0];
    const clusters = board.clusters.slice(0, 6);
    const clusterPos: Record<string, { cx: number; cy: number; color: string }> = {};
    const cols = Math.ceil(Math.sqrt(clusters.length)); const rows = Math.ceil(clusters.length / cols);
    clusters.forEach((cl, i) => {
      const gx = i % cols, gy = Math.floor(i / cols);
      clusterPos[cl.name] = { cx: W * (0.22 + 0.56 * (cols === 1 ? .5 : gx / (cols - 1 || 1))), cy: H * (0.26 + 0.5 * (rows === 1 ? .5 : gy / (rows - 1 || 1))), color: DOT_COLORS[i % DOT_COLORS.length] };
    });

    // deterministic pseudo-random so layout is stable across redraws (no Math.random per frame issues)
    const rand = (seed: number) => { const x = Math.sin(seed * 9973.7) * 43758.5453; return x - Math.floor(x); };
    const dots: Dot[] = [];
    board.dots.forEach((d, i) => {
      const cp = clusterPos[d.cluster] || { cx: W / 2, cy: H / 2, color: "#8A6BFF" };
      const a = rand(i) * Math.PI * 2, r = 18 + rand(i + 999) * 78;
      const x = cp.cx + Math.cos(a) * r, y = cp.cy + Math.sin(a) * r * 0.8;
      dots.push({ ...d, x, y, c: statusDotColor(tones[d.status]) || cp.color });
    });
    dotsRef.current = dots;

    let raf = 0, t = 0;
    const reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;
    function frame() {
      ctx.clearRect(0, 0, W, H);
      // faint cluster halos + labels
      clusters.forEach((cl) => { const cp = clusterPos[cl.name]; if (!cp) return;
        const g = ctx.createRadialGradient(cp.cx, cp.cy, 0, cp.cx, cp.cy, 120);
        g.addColorStop(0, cp.color + "22"); g.addColorStop(1, cp.color + "00");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cp.cx, cp.cy, 120, 0, Math.PI * 2); ctx.fill();
      });
      // dots with gentle twinkle
      dots.forEach((d, i) => {
        const tw = reduce ? 1 : 0.7 + 0.3 * Math.sin(t / 40 + i);
        ctx.beginPath(); ctx.arc(d.x!, d.y!, 2.6 + (d.c === "#FF5470" ? 1.4 : 0), 0, Math.PI * 2);
        ctx.fillStyle = d.c!; ctx.globalAlpha = tw; ctx.fill();
        if (d.c === "#FF5470") { ctx.globalAlpha = 0.3 * tw; ctx.beginPath(); ctx.arc(d.x!, d.y!, 7, 0, Math.PI * 2); ctx.fillStyle = "#FF5470"; ctx.fill(); }
        ctx.globalAlpha = 1;
      });
      // cluster labels
      clusters.forEach((cl) => { const cp = clusterPos[cl.name]; if (!cp) return;
        ctx.fillStyle = "#EDECFB"; ctx.font = "700 13px Rubik, sans-serif"; ctx.textAlign = "center"; ctx.direction = "rtl";
        ctx.fillText(cl.name, cp.cx, cp.cy - 128); ctx.fillStyle = "#8B88A8"; ctx.font = "600 11px Rubik, sans-serif";
        ctx.fillText(`${cl.n} ${board.entity}`, cp.cx, cp.cy - 112);
      });
      t++; if (!reduce) raf = requestAnimationFrame(frame);
    }
    frame();
    return () => cancelAnimationFrame(raf);
  }, [data, tones]);

  function onClick(e: React.MouseEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let hit: Dot | null = null, best = 12;
    for (const d of dotsRef.current) { const dist = Math.hypot(d.x! - mx, d.y! - my); if (dist < best) { best = dist; hit = d; } }
    if (hit) setSel(hit);
  }

  if (err) return <ErrBox msg={err} />;
  if (!data) return <Spinner label="בונה את מפת האימפקט..." />;
  const totalDots = data.reduce((s, b) => s + b.dots.length, 0);
  const atRisk = data.flatMap((b) => b.dots).filter((d) => tones[d.status] === "risk").length;

  return (
    <div style={{ animation: "rise .4s both" }}>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 2px" }}>מפת האימפקט</h1>
        <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>{names.join(" · ")} · כל נקודה = {data[0]?.entity?.slice(0, -2) || "אדם"}, אשכולות לפי "{data[0]?.clusterTitle || "קטגוריה"}"</p>
      </div>
      <div ref={wrapRef} style={{ position: "relative", background: "radial-gradient(120% 120% at 70% 0%, #1A1636 0%, #0C0A1E 60%)", borderRadius: 24, overflow: "hidden", boxShadow: "0 20px 50px -20px rgba(30,20,70,.5)" }}>
        <canvas ref={canvasRef} onClick={onClick} style={{ display: "block", cursor: "pointer" }} />
        {/* floating stats on the map */}
        <div style={{ position: "absolute", top: 16, insetInlineEnd: 20, textAlign: "left", color: "#EDECFB" }}>
          <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-.02em" }}>{totalDots.toLocaleString("he-IL")}</div>
          <div style={{ fontSize: 12, color: "#9A97B8" }}>{data[0]?.entity} על המפה</div>
          {atRisk > 0 && <div style={{ marginTop: 10, color: "#FF7A93", fontSize: 13, fontWeight: 700 }}>● {atRisk} דורשים תשומת לב</div>}
        </div>
        {/* legend */}
        <div style={{ position: "absolute", bottom: 14, insetInlineStart: 18, display: "flex", gap: 14, fontSize: 11.5, color: "#B8B5D0" }}>
          <Legend c="#8A6BFF" t="אדם" /><Legend c="#12C7A8" t="הסתיים" /><Legend c="#FF5470" t="דורש תשומת לב" />
        </div>
      </div>
      {sel && <DotProfile d={sel} entity={data[0]?.entity || ""} onClose={() => setSel(null)} />}
    </div>
  );
}
function Legend({ c, t }: { c: string; t: string }) { return <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />{t}</span>; }

/* dot → profile panel with STORY timeline */
function DotProfile({ d, entity, onClose }: { d: Dot; entity: string; onClose: () => void }) {
  // Build a story timeline from any date-like fields, sorted chronologically.
  const events = d.fields
    .filter((f) => /\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2}/.test(f.text))
    .map((f) => ({ label: f.title, date: f.text }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const other = d.fields.filter((f) => !/\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2}/.test(f.text));
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(12,10,30,.5)", zIndex: 50, display: "grid", placeItems: "center", padding: 20, animation: "fade .2s both" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 24, maxWidth: 480, width: "100%", maxHeight: "86vh", overflowY: "auto", boxShadow: "0 30px 80px -20px rgba(20,10,60,.5)", animation: "pop .25s both" }}>
        <div style={{ padding: "22px 24px 16px", background: `linear-gradient(135deg,${C.grape},${C.coral})`, color: "#fff", position: "relative" }}>
          <button onClick={onClose} style={{ position: "absolute", top: 16, insetInlineStart: 18, background: "rgba(255,255,255,.2)", border: "none", color: "#fff", width: 30, height: 30, borderRadius: 9, cursor: "pointer", fontSize: 15 }}>✕</button>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div style={{ width: 52, height: 52, borderRadius: 16, background: "rgba(255,255,255,.22)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 19 }}>{initials(d.name)}</div>
            <div><div style={{ fontSize: 20, fontWeight: 800 }}>{d.name}</div><div style={{ fontSize: 13, opacity: .9 }}>{d.cluster}{d.status ? ` · ${d.status}` : ""}</div></div>
          </div>
        </div>
        <div style={{ padding: "18px 24px 24px" }}>
          {events.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.grape, marginBottom: 12 }}>מסע {entity.slice(0, -2) || "המשתתף"}</div>
              <div style={{ position: "relative", paddingInlineStart: 22 }}>
                <div style={{ position: "absolute", insetInlineStart: 6, top: 4, bottom: 4, width: 2, background: `linear-gradient(${C.grape},${C.coral})` }} />
                {events.map((e, i) => (
                  <div key={i} style={{ position: "relative", paddingBottom: i === events.length - 1 ? 0 : 16 }}>
                    <span style={{ position: "absolute", insetInlineStart: -20, top: 3, width: 12, height: 12, borderRadius: "50%", background: "#fff", border: `3px solid ${i === events.length - 1 ? C.coral : C.grape}` }} />
                    <div style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{e.date}</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{e.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 9 }}>
            {other.slice(0, 12).map((f, i) => (
              <div key={i} style={{ background: "#F7F6FC", borderRadius: 11, padding: "8px 11px" }}>
                <div style={{ fontSize: 10.5, color: C.muted }}>{f.title}</div>
                <div style={{ fontSize: 12.5, fontWeight: 600, wordBreak: "break-word" }}>{f.text}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <style>{`@keyframes fade{from{opacity:0}}@keyframes pop{from{opacity:0;transform:scale(.96) translateY(10px)}}`}</style>
    </div>
  );
}

/* ===== "מה מטרת הלוח" (W2-1, גרסה 2 — משוב מיטל 1.9) =====
   The chips UX is gone: marking what matters now happens ON the board itself
   (⭐ pins a card, ✕ hides one). What remains here is the one thing a card
   cannot say — the board's PURPOSE in the user's own words, which feeds the
   wizard's AI. Saving spreads the fetched document and changes only
   goalsText: a partial write would wipe the pins the user just made. */

function PrefsCard({ boardId, boardName }: { boardId: string; boardName: string }) {
  const [open, setOpen] = useState(false);
  const [editable, setEditable] = useState(true);
  const [prefs, setPrefs] = useState<Record<string, unknown>>({});
  const [goals, setGoals] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/board-prefs?board=${boardId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive || d.error) return;
        setPrefs((d.prefs as Record<string, unknown>) ?? {});
        setGoals((d.prefs?.goalsText as string) ?? "");
        setEditable(d.editable !== false);
        setLoaded(true);
      })
      .catch(() => { /* the card is a nicety — its absence must not break the dashboard */ });
    return () => { alive = false; };
  }, [boardId]);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/board-prefs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId, prefs: { ...prefs, goalsText: goals } }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(d.error || "השמירה נכשלה");
      else {
        setPrefs({ ...prefs, goalsText: goals }); setMsg("נשמר ✓"); setOpen(false);
        // עמודה שהוזכרה במשפט משנה את סדר הלוח — שיראו את זה מיד, לא ברענון הבא.
        window.dispatchEvent(new Event("anyday-refresh"));
      }
    } catch {
      setMsg("לא הצלחנו לפנות לשרת");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null; // personal mode / not signed in — the card simply is not there
  const savedGoals = ((prefs.goalsText as string) ?? "").trim();

  return (
    <div style={{ background: C.panel, border: "1px solid #ECEBF5", borderInlineStart: `4px solid ${savedGoals ? C.teal : C.amber}`, borderRadius: 16, marginBottom: 16, animation: "rise .4s both" }}>
      <button onClick={() => { setOpen(!open); setMsg(null); }} aria-expanded={open} style={{ width: "100%", border: "none", background: "none", fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", textAlign: "right" }}>
        <span style={{ fontSize: 16 }}>🎯</span>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>{`מה מטרת ״${boardName}״?`}</span>
        <span style={{ fontSize: 12, color: C.muted, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {savedGoals ? `"${savedGoals}"` : "ספרו במשפט — וסמנו ★ על הרכיבים החשובים בלוח עצמו"}
        </span>
        <span aria-hidden style={{ fontSize: 11, color: C.muted }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 18px 16px" }}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, lineHeight: 1.6 }}>
            המשפט הזה מזין את הוויזרד כשבונים דשבורד חדש. ומה שחשוב לראות למעלה — מסמנים ★ ישירות על הכרטיס בלוח; ✕ מסתיר כרטיס פחות רלוונטי.
          </div>
          <textarea
            value={goals} onChange={(e) => setGoals(e.target.value)} disabled={!editable}
            placeholder="במילים שלכם: בשביל מה הלוח הזה? מה אתם רוצים לראות בו כל בוקר?"
            maxLength={500} rows={2}
            style={{ width: "100%", border: "1px solid #E6E4F0", borderRadius: 11, padding: "9px 12px", fontSize: 12.5, fontFamily: "inherit", resize: "vertical", outline: "none", marginBottom: 10, boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => void save()} disabled={busy || !editable} style={{ border: "none", background: C.grape, color: "#fff", borderRadius: 10, padding: "8px 18px", fontSize: 12.5, fontWeight: 700, cursor: busy ? "wait" : "pointer", fontFamily: "inherit" }}>
              {busy ? "שומרים…" : "שמירה"}
            </button>
            {!editable && <span style={{ fontSize: 11.5, color: C.muted }}>לצופה אין הרשאת עריכה</span>}
            {msg && <span style={{ fontSize: 11.5, color: msg.includes("✓") ? "#0B8F76" : C.coral }}>{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== saved dashboards + wizard (wave 3) =====
   The "לוח חי" tab is now a family: the automatic board (exactly what it
   always was) plus the org's SAVED dashboards — each born in the wizard from
   a purpose the user typed, approved before it was created, rendered live
   from its stored spec. No locked tab name was touched: it all lives here. */

interface SavedDash { id: string; title: string; purpose: string; sourceRef: string; createdAt: string }
interface SpecW { kind: string; col?: string }

const specWidgetLabel = (w: SpecW): string =>
  w.kind === "breakdown" ? `פילוח לפי "${w.col}"`
  : w.kind === "byOwner" ? `חלוקה לפי "${w.col}"`
  : w.kind === "numberSummary" ? `סיכום "${w.col}"`
  : w.kind === "crossBreakdown" ? `"${w.col}" מכל הלוחות יחד`
  : w.kind === "attention" ? "מי דורש תשומת לב"
  : "רשימת הפריטים";
const specKey = (w: SpecW) => `${w.kind}|${w.col ?? ""}`;

function DashboardsHome({ names, empty, activeBoards, allBoards, activeKey }: {
  names: string[]; empty: boolean; activeBoards: BoardOpt[]; allBoards: BoardOpt[]; activeKey: string;
}) {
  const [list, setList] = useState<SavedDash[]>([]);
  const [sel, setSel] = useState<string>("auto");
  const [wiz, setWiz] = useState(false);

  const load = () => {
    fetch("/api/dashboards", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.dashboards)) setList(d.dashboards); })
      .catch(() => { /* saved dashboards are additive — their absence hides the pills, nothing more */ });
  };
  useEffect(load, []);

  const pill = (on: boolean): React.CSSProperties => ({
    border: `1.5px solid ${on ? C.grape : "#E6E4F0"}`, background: on ? C.grapeL : C.panel,
    color: on ? C.grape : C.muted, borderRadius: 99, padding: "7px 15px", fontSize: 12.5,
    fontWeight: on ? 800 : 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
  });

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <button style={pill(sel === "auto")} onClick={() => setSel("auto")}>⚡ הלוח החי</button>
        {list.map((d) => (
          <button key={d.id} style={pill(sel === d.id)} onClick={() => setSel(d.id)} title={d.purpose || d.title}>◆ {d.title}</button>
        ))}
        {allBoards.length > 0 && (
          <button
            onClick={() => setWiz(true)}
            style={{ border: "1.5px dashed #C9C5E8", background: "none", color: C.grape, borderRadius: 99, padding: "7px 15px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
          >+ דשבורד חדש</button>
        )}
      </div>
      {sel === "auto"
        ? <Dashboard key={activeKey} names={names} empty={empty} boards={activeBoards} />
        : <SavedDashboardView key={sel} id={sel} onGone={() => { setSel("auto"); load(); }} />}
      {wiz && (
        <DashboardWizard
          boards={allBoards}
          onClose={() => setWiz(false)}
          onCreated={(id) => { setWiz(false); load(); setSel(id); }}
        />
      )}
    </>
  );
}

/* One saved dashboard, rendered live from its stored spec. */
function SavedDashboardView({ id, onGone }: { id: string; onGone: () => void }) {
  const [d, setD] = useState<{ title: string; purpose: string; boardName: string; widgets: Widget[]; coverage?: Cov } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/dashboards/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((x) => {
        if (!alive) return;
        if (x.error) setErr(x.error); else setD(x);
      })
      .catch(() => { if (alive) setErr("שגיאה"); });
    return () => { alive = false; };
  }, [id]);

  async function confirmDelete() {
    setBusy(true);
    try {
      const r = await fetch(`/api/dashboards/${id}`, { method: "DELETE" });
      if (r.ok) onGone();
      else setErr((await r.json().catch(() => ({}))).error || "המחיקה נכשלה");
    } finally { setBusy(false); setAsking(false); }
  }

  if (err) return <ErrBox msg={err} />;
  if (!d) return <Spinner label="טוען את הדשבורד..." />;

  const attention = d.widgets.find((w) => w.kind === "attention");
  const attData = attention?.data as { count: number; items: { name: string; why: string }[] } | undefined;
  const rest = d.widgets.filter((w) => w.kind !== "attention");

  return (
    <div style={{ animation: "rise .4s both" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 style={{ fontSize: 23, fontWeight: 800, margin: "0 0 2px" }}>◆ {d.title}</h1>
          <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
            {`${d.purpose ? `"${d.purpose}" · ` : ""}חי מ-Monday · בורד "${d.boardName}"${d.coverage?.truncated ? ` · ${d.coverage.note}` : ""}`}
          </p>
        </div>
        {asking ? (
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 12 }}>למחוק את הדשבורד?</span>
            <button onClick={() => void confirmDelete()} disabled={busy} style={{ border: "none", background: C.coral, color: "#fff", borderRadius: 9, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: busy ? "wait" : "pointer", fontFamily: "inherit" }}>{busy ? "מוחקים…" : "כן, מחקו"}</button>
            <button onClick={() => setAsking(false)} style={{ border: "1px solid #E6E4F0", background: "#fff", color: C.muted, borderRadius: 9, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>ביטול</button>
          </div>
        ) : (
          <button onClick={() => setAsking(true)} title="מוחק את הדשבורד השמור. הנתונים ב-Monday לא משתנים." style={{ border: "1px solid #E6E4F0", background: "#fff", color: C.muted, borderRadius: 9, padding: "6px 13px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>מחיקה</button>
        )}
      </div>
      {attData && attData.count > 0 && (
        <div style={{ background: `linear-gradient(120deg,${C.coralL},${C.amberL})`, border: `1px solid ${C.coral}30`, borderRadius: 18, padding: "14px 18px", marginBottom: 16, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ fontSize: 26 }}>⚠️</div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 800, fontSize: 14.5 }}>{attData.count} דורשים תשומת לב</div>
            <div style={{ fontSize: 12.5, color: C.muted }}>{attData.items.slice(0, 3).map((x) => x.name).join(" · ")}{attData.count > 3 ? " ועוד…" : ""}</div>
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14, alignItems: "start" }}>
        {rest.map((w, i) => <ChartCard key={i} w={w} i={i} />)}
      </div>
    </div>
  );
}

/* The wizard itself: purpose → proposal → approve → save. Nothing exists
   until the user clicks save — preview→approve, the cbb8b80 principle. */
function DashboardWizard({ boards, onClose, onCreated }: {
  boards: BoardOpt[]; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [boardId, setBoardId] = useState(boards[0]?.id ?? "");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<SpecW[]>([]);
  const [menu, setMenu] = useState<SpecW[]>([]);
  const [usedAi, setUsedAi] = useState(false);
  /* "ביקשת עמודה שלא בלוח הזה — היא קיימת בלוח אחר": ההודעה הכנה מהשרת,
     עם כפתור שמעביר ללוח הנכון (המקרה של מיטל עם "סטטוס טיפול"). */
  const [note, setNote] = useState<{ text: string; boardId: string; boardName: string } | null>(null);
  /* חיתוך חוצה-לוחות: העמודה קיימת בכמה לוחות (אחד לכל בית ספר) — ההצעה
     החכמה היא דשבורד אחד שקורא אותה מכולם, בפילוח לפי לוח (בקשת מיטל). */
  const [cross, setCross] = useState<{ column: string; boardIds: string[]; boardNames: string[] } | null>(null);
  const [crossSave, setCrossSave] = useState<string[] | null>(null);
  /* Example purposes, built from the SELECTED board's own columns (משוב מיטל:
     "צריך לתת דוגמאות לדברים שאפשר לבנות") — an example naming the user's real
     column teaches what a purpose looks like better than generic text. */
  const [examples, setExamples] = useState<string[]>([]);
  useEffect(() => {
    if (!boardId) return;
    let alive = true;
    fetch(`/api/board-profile?boards=${boardId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (alive && d.profiles?.[0]) setExamples(examplePurposes(d.profiles[0] as BoardProfile)); })
      .catch(() => { /* examples are a nicety — the wizard works without them */ });
    return () => { alive = false; };
  }, [boardId]);

  async function propose() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/dashboard-wizard", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId, purpose }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || "ההצעה נכשלה"); return; }
      setTitle(d.spec.title); setPicked(d.spec.widgets); setMenu(d.menu || d.spec.widgets); setUsedAi(Boolean(d.usedAi));
      setNote(d.note ?? null);
      setCross(d.cross ?? null);
      setCrossSave(null);
      setStep(2);
    } catch { setErr("לא הצלחנו לפנות לשרת"); }
    finally { setBusy(false); }
  }

  /* המעבר להצעה החוצה: רכיב אחד שקורא את העמודה מכל הלוחות שנמצאה בהם. */
  function goCross() {
    if (!cross) return;
    setPicked([{ kind: "crossBreakdown", col: cross.column }]);
    setMenu([{ kind: "crossBreakdown", col: cross.column }]);
    setTitle(`"${cross.column}" לפי לוח`);
    setCrossSave(cross.boardIds);
    setUsedAi(false);
    setNote(null);
  }

  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/dashboards", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          crossSave
            ? { boardIds: crossSave, title, purpose, spec: { widgets: picked } }
            : { boardId, title, purpose, spec: { widgets: picked } }
        ),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || "השמירה נכשלה"); return; }
      onCreated(d.id);
    } catch { setErr("לא הצלחנו לפנות לשרת"); }
    finally { setBusy(false); }
  }

  function toggle(w: SpecW) {
    const on = picked.some((p) => specKey(p) === specKey(w));
    if (on) setPicked(picked.filter((p) => specKey(p) !== specKey(w)));
    else if (picked.length < 8) setPicked([...picked, w]);
  }

  /* The proposal's order first (the AI ordered by the purpose), then whatever
     else the board supports, unchecked. */
  const rows: SpecW[] = [...picked, ...menu.filter((m) => !picked.some((p) => specKey(p) === specKey(m)))];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(27,24,48,.44)", zIndex: 40, display: "grid", placeItems: "center", padding: 16, animation: "fade .2s both" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="דשבורד חדש" style={{ background: "#fff", borderRadius: 20, width: "min(560px, 100%)", maxHeight: "88vh", overflowY: "auto", padding: "22px 24px", animation: "pop .25s both" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 800, flex: 1 }}>דשבורד חדש</div>
          <button onClick={onClose} aria-label="סגירה" style={{ border: "none", background: "#F4F3FB", borderRadius: 9, width: 30, height: 30, cursor: "pointer", fontSize: 14, color: C.muted }}>✕</button>
        </div>

        {step === 1 && (
          <>
            <p style={{ fontSize: 13, color: C.muted, margin: "0 0 14px", lineHeight: 1.7 }}>
              ספרו מה הדשבורד צריך לענות — והמערכת תרכיב הצעה מהנתונים שבאמת קיימים בלוח. שום דבר לא נוצר בלי אישורכם.
            </p>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>על איזה בורד?</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14, maxHeight: 180, overflowY: "auto" }}>
              {boards.map((b, i) => {
                const on = boardId === b.id; const c = pick(i);
                return (
                  <button key={b.id} onClick={() => setBoardId(b.id)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", borderRadius: 12, border: `1.5px solid ${on ? c.fg : "#ECEBF5"}`, background: on ? c.bg : "#FAF9FE", cursor: "pointer", textAlign: "right", fontFamily: "inherit" }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: c.fg, opacity: on ? 1 : .3 }} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: on ? 700 : 500 }}>{b.name}</span>
                    <span style={{ fontSize: 11, color: C.muted }}>{b.items}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>מה מטרת הדשבורד?</div>
            {examples.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, alignSelf: "center" }}>למשל:</span>
                {examples.map((e) => (
                  <button key={e} onClick={() => setPurpose(e)}
                    style={{ border: "1px solid #E6E4F0", background: purpose === e ? C.grapeL : "#FAF9FE", color: purpose === e ? C.grape : C.muted, borderRadius: 99, padding: "4px 11px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textAlign: "right" }}>
                    {e}
                  </button>
                ))}
              </div>
            )}
            <textarea
              value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={500} rows={3} autoFocus
              placeholder="במילים שלכם: על מה הדשבורד צריך לענות כל בוקר? (או לחצו על דוגמה למעלה)"
              style={{ width: "100%", border: "1px solid #E6E4F0", borderRadius: 12, padding: "10px 13px", fontSize: 13, fontFamily: "inherit", resize: "vertical", outline: "none", boxSizing: "border-box", marginBottom: 14 }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={() => void propose()} disabled={busy || !boardId} style={{ border: "none", background: C.grape, color: "#fff", borderRadius: 11, padding: "10px 22px", fontSize: 13.5, fontWeight: 700, cursor: busy ? "wait" : "pointer", fontFamily: "inherit" }}>
                {busy ? "מרכיבים הצעה…" : "הציעו לי דשבורד ←"}
              </button>
              {err && <span style={{ fontSize: 12, color: C.coral }}>{err}</span>}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            {note && (
              <div style={{ background: C.amberL, border: `1px solid ${C.amber}55`, borderRadius: 12, padding: "10px 14px", marginBottom: 12 }}>
                <div style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.6, marginBottom: 7 }}>💡 {note.text}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {cross && (
                    <button
                      onClick={goCross}
                      style={{ border: "none", background: C.grape, color: "#fff", borderRadius: 9, padding: "6px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                    >{`📊 להציג את ״${cross.column}״ מכל ${cross.boardIds.length} הלוחות יחד ←`}</button>
                  )}
                  <button
                    onClick={() => { setBoardId(note.boardId); setNote(null); setCross(null); setStep(1); }}
                    style={{ border: "none", background: C.amber, color: "#fff", borderRadius: 9, padding: "6px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                  >{`לבנות על ״${note.boardName}״ בלבד ←`}</button>
                </div>
              </div>
            )}
            {crossSave && cross && (
              <div style={{ background: C.grapeL, border: `1px solid ${C.grape}44`, borderRadius: 12, padding: "10px 14px", marginBottom: 12, fontSize: 12.5, color: C.ink, lineHeight: 1.6 }}>
                📊 דשבורד חוצה-לוחות: ״{cross.column}״ ייקרא חי מ-{cross.boardNames.join(" · ")} — ויוצג בפילוח לפי לוח.
              </div>
            )}
            <p style={{ fontSize: 12.5, color: C.muted, margin: "0 0 14px", lineHeight: 1.7 }}>
              {usedAi ? "ההצעה הורכבה לפי המטרה שכתבתם — רק מרכיבים שהלוח באמת תומך בהם." : "הצעה אוטומטית מהמנוע (ה-AI לא היה זמין) — רק מרכיבים שהלוח באמת תומך בהם."}
              {" "}סמנו והורידו כרצונכם; הדשבורד ייווצר רק בלחיצה על שמירה.
            </p>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>שם הדשבורד</div>
            <input
              value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80}
              style={{ width: "100%", border: "1px solid #E6E4F0", borderRadius: 11, padding: "9px 13px", fontSize: 13.5, fontWeight: 700, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 12 }}
            />
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>הרכיבים ({picked.length}/8)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {rows.map((w) => {
                const on = picked.some((p) => specKey(p) === specKey(w));
                return (
                  <button key={specKey(w)} onClick={() => toggle(w)} aria-pressed={on} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 12, border: `1.5px solid ${on ? C.grape : "#ECEBF5"}`, background: on ? C.grapeL : "#FAF9FE", cursor: "pointer", textAlign: "right", fontFamily: "inherit" }}>
                    <span style={{ width: 17, height: 17, borderRadius: 6, border: `2px solid ${on ? C.grape : "#C9C5E8"}`, background: on ? C.grape : "#fff", color: "#fff", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800 }}>{on ? "✓" : ""}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: on ? 700 : 500, color: on ? C.ink : C.muted }}>{specWidgetLabel(w)}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={() => void save()} disabled={busy || !picked.length || !title.trim()} style={{ border: "none", background: C.grape, color: "#fff", borderRadius: 11, padding: "10px 22px", fontSize: 13.5, fontWeight: 700, cursor: busy ? "wait" : "pointer", fontFamily: "inherit", opacity: !picked.length || !title.trim() ? .5 : 1 }}>
                {busy ? "שומרים…" : "✓ שמירת הדשבורד"}
              </button>
              <button onClick={() => { setStep(1); setErr(null); }} disabled={busy} style={{ border: "1px solid #E6E4F0", background: "#fff", color: C.muted, borderRadius: 11, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>→ חזרה</button>
              {err && <span style={{ fontSize: 12, color: C.coral }}>{err}</span>}
            </div>
          </>
        )}
      </div>
      <style>{`@keyframes fade{from{opacity:0}}@keyframes pop{from{opacity:0;transform:scale(.96) translateY(10px)}}`}</style>
    </div>
  );
}

/* ===== dashboard (charts fallback) ===== */
/** A live-board chart plus its curation identity (key+board) and ⭐ state. */
type LiveChart = Widget & { key: string; boardId: string; pinned: boolean };
interface MoreWidget { key: string; boardId: string; label: string; hiddenByUser: boolean }

function Dashboard({ names, empty = false, boards = [] }: { names: string[]; empty?: boolean; boards?: BoardOpt[] }) {
  const [d, setD] = useState<{ kpis: KPI[]; charts: LiveChart[]; more?: MoreWidget[]; attention: { count: number; items: { name: string; why: string; board: string }[] }; coverage?: Cov; source: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => { setD(null); setErr(null);
    fetch("/api/dashboard", { cache: "no-store" }).then((r) => r.json()).then((x) => x.error ? setErr(x.error) : setD(x)).catch(() => setErr("שגיאה"));
  };

  /* ⭐/✕ write to board_preferences: read the CURRENT doc, change one list,
     write the whole doc back — a partial POST would wipe the other fields. */
  async function updatePrefs(boardId: string, change: (p: Record<string, unknown>) => Record<string, unknown>) {
    try {
      const cur = await fetch(`/api/board-prefs?board=${boardId}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      const prefs = change((cur?.prefs as Record<string, unknown>) ?? {});
      const r = await fetch("/api/board-prefs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId, prefs }),
      });
      if (r.ok) load();
    } catch { /* curation is a nicety — a failed save leaves the board as it was */ }
  }
  const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
  const togglePin = (c: LiveChart) => void updatePrefs(c.boardId, (p) => ({
    ...p,
    pinnedWidgets: c.pinned ? arr(p.pinnedWidgets).filter((k) => k !== c.key) : [...arr(p.pinnedWidgets), c.key],
    hiddenWidgets: arr(p.hiddenWidgets).filter((k) => k !== c.key),
  }));
  const hideChart = (c: LiveChart) => void updatePrefs(c.boardId, (p) => ({
    ...p,
    hiddenWidgets: [...arr(p.hiddenWidgets).filter((k) => k !== c.key), c.key],
    pinnedWidgets: arr(p.pinnedWidgets).filter((k) => k !== c.key),
  }));
  const bringBack = (m: MoreWidget) => void updatePrefs(m.boardId, (p) => ({
    ...p,
    hiddenWidgets: arr(p.hiddenWidgets).filter((k) => k !== m.key),
    // A widget the relevance layer dropped comes back PINNED — the user just
    // said it matters, and a pin is the only thing that outranks the layer.
    pinnedWidgets: m.hiddenByUser ? arr(p.pinnedWidgets) : [...arr(p.pinnedWidgets).filter((k) => k !== m.key), m.key],
  }));
  useEffect(() => { load();
    const h = () => load(); window.addEventListener("anyday-refresh", h);
    return () => window.removeEventListener("anyday-refresh", h);
  }, []);
  if (err) return <ErrBox msg={err} />;
  if (!d) return <Spinner label="בונה את הלוח החי..." />;
  return (
    <div style={{ animation: "rise .4s both" }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 23, fontWeight: 800, margin: "0 0 2px" }}>הלוח של {names.join(" · ")}</h1>
        <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>מתעדכן חי מ-Monday{d.coverage?.truncated ? ` · ${d.coverage.note}` : ""}</p>
      </div>
      {/* "מה חשוב לך" — one slim row per board on the roof (W2-1). */}
      {boards.map((b) => <PrefsCard key={b.id} boardId={b.id} boardName={b.name} />)}
      {/* A board with no rows is not a broken board - say it plainly instead of
          showing a grid of zeros with no explanation. */}
      {empty && (
        <div style={{ background: C.panel, border: "1px solid #ECEBF5", borderInlineStart: `4px solid ${C.grape}`, borderRadius: 16, padding: "14px 18px", marginBottom: 16 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, marginBottom: 4 }}>{"אין עדיין רשומות בבורד הזה"}</div>
          <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, margin: 0 }}>{"הבורד ריק, ולכן אין מה להציג על הלוח. הוסיפו לו רשומות ב-Monday, והלוח יתמלא מיד."}</p>
        </div>
      )}
      {/* KPI tiles — colorful, animated numbers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 16 }}>
        {d.kpis.map((k, i) => <KpiTile key={i} k={k} i={i} />)}
      </div>
      {/* attention banner if any */}
      {d.attention.count > 0 && (
        <div style={{ background: `linear-gradient(120deg,${C.coralL},${C.amberL})`, border: `1px solid ${C.coral}30`, borderRadius: 18, padding: "14px 18px", marginBottom: 16, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", animation: "rise .5s both" }}>
          <div style={{ fontSize: 26 }}>⚠️</div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 800, fontSize: 14.5 }}>{d.attention.count} דורשים תשומת לב</div>
            <div style={{ fontSize: 12.5, color: C.muted }}>{d.attention.items.slice(0, 3).map((x) => x.name).join(" · ")}{d.attention.count > 3 ? " ועוד…" : ""}</div>
          </div>
        </div>
      )}
      {/* chart cards — pinned first (the server ordered them); ⭐/✕ curate in place */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14, alignItems: "start" }}>
        {d.charts.map((w, i) => (
          <ChartCard key={w.key || i} w={w} i={i} pinned={w.pinned} onPin={() => togglePin(w)} onHide={() => hideChart(w)} />
        ))}
      </div>
      {/* what did NOT earn a place — hidden by the user, or dropped by the
          relevance layer as telling no story. One click brings any back. */}
      {(d.more?.length ?? 0) > 0 && (
        <div style={{ marginTop: 16, background: C.panel, border: "1px dashed #E0DEF0", borderRadius: 14, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 700 }}>עוד רכיבים ({d.more!.length}):</span>
          {d.more!.map((m) => (
            <button key={`${m.boardId}-${m.key}`} onClick={() => bringBack(m)}
              title={m.hiddenByUser ? "הסתרתם את זה — לחיצה מחזירה ללוח" : "לא נמצא בו סיפור מעניין — לחיצה מצמידה אותו ללוח בכל זאת"}
              style={{ border: "1px solid #E6E4F0", background: "#FAF9FE", color: C.muted, borderRadius: 99, padding: "4px 11px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              ＋ {m.label}{m.hiddenByUser ? " (הוסתר)" : ""}
            </button>
          ))}
        </div>
      )}
      <style>{`@keyframes rise{from{opacity:0;transform:translateY(8px)}}`}</style>
    </div>
  );
}
function KpiTile({ k, i }: { k: KPI; i: number }) {
  const c = k.tone === "rose" ? { fg: C.coral, bg: C.coralL } : k.tone === "mint" ? { fg: C.teal, bg: C.tealL } : k.tone === "brand" ? { fg: C.grape, bg: C.grapeL } : pick(i + 3);
  const n = useCountUp(k.n);
  return (
    <div style={{ background: C.panel, border: `1px solid #ECEBF5`, borderRadius: 18, padding: "16px 18px", boxShadow: "0 4px 16px -8px rgba(60,50,120,.14)", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: -14, insetInlineStart: -14, width: 60, height: 60, borderRadius: "50%", background: c.bg, opacity: .6 }} />
      <div style={{ position: "relative" }}>
        <div style={{ width: 40, height: 40, borderRadius: 13, background: c.bg, color: c.fg, display: "grid", placeItems: "center", fontSize: 20, marginBottom: 10 }}>{k.icon}</div>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.02em", fontVariantNumeric: "tabular-nums", color: c.fg }}>{n.toLocaleString("he-IL")}</div>
        <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 600 }}>{k.label}</div>
      </div>
    </div>
  );
}
function ChartCard({ w, i, pinned, onPin, onHide }: {
  w: Widget; i: number;
  /** Live-board curation (משוב מיטל 1.9): ⭐ pins the card first, ✕ hides it.
      Saved dashboards pass none of these and render exactly as before. */
  pinned?: boolean; onPin?: () => void; onHide?: () => void;
}) {
  const c = pick(i);
  const act: React.CSSProperties = { border: "none", background: "none", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "3px 5px", borderRadius: 7, color: "#B4B2C6" };
  return (
    <div style={{ background: C.panel, border: `1px solid ${pinned ? C.grape + "55" : "#ECEBF5"}`, borderRadius: 18, padding: "16px 18px", boxShadow: "0 4px 16px -8px rgba(60,50,120,.12)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ width: 8, height: 22, borderRadius: 4, background: c.fg }} />
        <div style={{ fontSize: 14, fontWeight: 800, flex: 1 }}>{w.title}</div>
        {onPin && (
          <button onClick={onPin} title={pinned ? "ביטול ההצמדה" : "חשוב לי — הצמדה לראש הלוח"} aria-label={pinned ? `ביטול הצמדה של ${w.title}` : `הצמדת ${w.title} לראש הלוח`} aria-pressed={pinned} style={{ ...act, color: pinned ? C.amber : "#B4B2C6" }}>
            {pinned ? "★" : "☆"}
          </button>
        )}
        {onHide && (
          <button onClick={onHide} title="פחות רלוונטי — הסתרה מהלוח (אפשר להחזיר למטה)" aria-label={`הסתרת ${w.title} מהלוח`} style={act}>✕</button>
        )}
      </div>
      <ChartBody w={w} c={c} />
      <div style={{ marginTop: 12, fontSize: 10.5, color: "#B4B2C6", borderTop: "1px dashed #EEEDF5", paddingTop: 8 }}>🔎 {w.source}</div>
    </div>
  );
}
function ChartBody({ w, c }: { w: Widget; c: { fg: string; bg: string } }) {
  const d = w.data as Record<string, unknown>;
  const drill = (w as Widget & { drill?: Record<string, string[]> }).drill;
  const [openRow, setOpenRow] = useState<string | null>(null);
  if (w.kind === "breakdown" || w.kind === "byOwner") {
    const rows = (d.rows as { label: string; n: number; tone?: string }[]) || []; const max = Math.max(...rows.map((r) => r.n), 1);
    return <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>{rows.slice(0, 8).map((r, i) => { const sc = w.kind === "breakdown" ? toneStyle(r.tone) : pick(i); const canOpen = drill && drill[r.label]?.length; const isOpen = openRow === r.label;
      return <div key={r.label} style={{ display: "grid", gap: 4 }}>
        <button onClick={() => canOpen && setOpenRow(isOpen ? null : r.label)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, background: "none", border: "none", padding: 0, cursor: canOpen ? "pointer" : "default", fontFamily: "inherit", color: C.ink, textAlign: "right" }}>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 190 }}>{r.label}{canOpen && <span style={{ color: C.grape, background: C.grapeL, marginInlineStart: 7, fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 999, whiteSpace: "nowrap" }}>{isOpen ? "▾ הסתר" : `הצג ${r.n} שמות`}</span>}</span>
          <b style={{ fontVariantNumeric: "tabular-nums", color: sc.fg }}>{r.n}</b>
        </button>
        <div style={{ height: 9, borderRadius: 999, background: "#F2F1F9", overflow: "hidden" }}><div style={{ width: `${(r.n / max) * 100}%`, height: "100%", background: sc.fg, borderRadius: 999, transition: "width .6s cubic-bezier(.2,.8,.2,1)" }} /></div>
        {isOpen && canOpen && <DrillList names={drill![r.label]} accent={sc.fg} />}
      </div>; })}</div>;
  }
  if (w.kind === "crossBreakdown") {
    // One column, read from several boards (בקשת מיטל): a group per board —
    // its name, a stacked bar of its own label colours, and the counts.
    const groups = (d.groups as { boardName: string; colTitle: string; total: number; rows: { label: string; n: number; tone?: string }[] }[]) || [];
    const skipped = (d.skipped as string[]) || [];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {groups.map((g) => {
          const shown = g.rows.filter((r) => r.label !== "— ריק —").slice(0, 6);
          const denom = g.total || 1;
          return (
            <div key={g.boardName}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>{g.boardName}</span>
                <span style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap" }}>{g.total} רשומות</span>
              </div>
              <div style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", background: "#F2F1F9", marginBottom: 6 }}>
                {shown.map((r) => (
                  <div key={r.label} title={`${r.label}: ${r.n}`} style={{ width: `${(r.n / denom) * 100}%`, background: toneStyle(r.tone).fg }} />
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {shown.map((r) => {
                  const sc = toneStyle(r.tone);
                  return (
                    <span key={r.label} style={{ fontSize: 10.5, fontWeight: 700, color: sc.fg, background: sc.bg, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
                      {r.label} · {r.n}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
        {skipped.length > 0 && (
          <div style={{ fontSize: 11, color: C.muted }}>בלוחות הבאים לא נמצאה העמודה: {skipped.join(" · ")}</div>
        )}
      </div>
    );
  }
  if (w.kind === "numberSummary")
    return <div style={{ display: "flex", gap: 10 }}>{[["סה\"כ", d.sum], ["ממוצע", d.avg], ["מקס׳", d.max]].map(([l, v]) => <div key={l as string} style={{ flex: 1, background: c.bg, borderRadius: 13, padding: "12px" }}><div style={{ fontSize: 20, fontWeight: 800, color: c.fg, fontVariantNumeric: "tabular-nums" }}>{String(v)}</div><div style={{ fontSize: 11, color: C.muted }}>{l as string}</div></div>)}</div>;
  if (w.kind === "list") { const items = (d.items as string[]) || [];
    return <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{items.slice(0, 10).map((n, i) => <span key={i} style={{ fontSize: 12, padding: "5px 11px", background: pick(i).bg, color: pick(i).fg, borderRadius: 999, fontWeight: 600 }}>{n}</span>)}</div>;
  }
  return null;
}

/* The names behind one segment. A sorted, scrollable column list — not a
   cloud of chips — so 49 names read like a list and 400 don't need a cap. */
function DrillList({ names, accent }: { names: string[]; accent: string }) {
  const [q, setQ] = useState("");
  const sorted = useMemo(() => [...names].sort((a, b) => a.localeCompare(b, "he")), [names]);
  const shown = q.trim() ? sorted.filter((n) => n.toLowerCase().includes(q.trim().toLowerCase())) : sorted;
  return (
    <div style={{ background: "#F8F7FC", border: "1px solid #ECEBF5", borderRadius: 12, padding: "8px 10px", marginTop: 2, animation: "fade .2s both" }}>
      {names.length > 12 && (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש בשמות…" aria-label="חיפוש בשמות"
          style={{ width: "100%", boxSizing: "border-box", fontSize: 12.5, padding: "6px 10px", border: "1px solid #E4E2F0", borderRadius: 8, background: C.panel, color: C.ink, fontFamily: "inherit", marginBottom: 6, outline: "none" }} />
      )}
      <div style={{ maxHeight: 216, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", columnGap: 12, rowGap: 1 }}>
        {shown.map((name, j) => (
          <div key={j} title={name} style={{ fontSize: 12.5, lineHeight: "22px", padding: "1px 8px", borderInlineStart: `2px solid ${accent}`, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
        ))}
        {shown.length === 0 && <div style={{ fontSize: 12, color: C.muted, padding: "6px 8px" }}>אין שם שמתאים ל"{q.trim()}"</div>}
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6, paddingTop: 6, borderTop: "1px dashed #EEEDF5", display: "flex", justifyContent: "space-between" }}>
        <span>{q.trim() ? `${shown.length} מתוך ${names.length}` : `${names.length} שמות`}</span>
        {names.length > 8 && <span style={{ opacity: .7 }}>לפי א״ב</span>}
      </div>
      <style>{`@keyframes fade{from{opacity:0}}`}</style>
    </div>
  );
}

/* ===== people = FULL MANAGEMENT (edit/add/delete/import → writes to Monday) ===== */
function People() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [err, setErr] = useState<string | null>(null); const [q, setQ] = useState(""); const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<"cards" | "list">("cards");
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [cov, setCov] = useState<Cov | null>(null);
  // tone map + the board's own word for a row - both derived server-side
  const [meta, setMeta] = useState<{ tones: ToneMap; entities: Record<string, string> } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // the selected boards' real columns — the only source for file→board matching
  const [boardInfo, setBoardInfo] = useState<BoardInfo[]>([]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);

  const load = () => fetch("/api/people", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (d.error) { setErr(d.error); return; } setPeople(d.people || []); setCov(d.coverage || null); setBoardInfo(d.boards || []); }).catch(() => setErr("שגיאה"));
  useEffect(() => { load();
    fetch("/api/dashboard?meta=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (!d.error) setMeta({ tones: d.tones || {}, entities: d.entities || {} }); })
      .catch(() => { /* colours simply stay neutral */ });
  }, []);
  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 2600); }

  async function addRecord(name: string) {
    const boardId = people?.[0]?.boardId; if (!boardId || !name.trim()) return;
    const r = await fetch("/api/record", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "create", boardId, name: name.trim() }) });
    const d = await r.json(); if (d.ok) { flash("נוסף ל-Monday ✓"); setAdding(false); load(); } else flash("שגיאה: " + d.error);
  }
  async function delRecord(id: string) {
    const r = await fetch("/api/record", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "delete", itemId: id }) });
    const d = await r.json(); if (d.ok) { flash("נמחק מ-Monday ✓"); setOpen(null); load(); } else flash("שגיאה: " + d.error);
  }
  /**
   * Reading a file does NOT import it. It builds a plan — which file column
   * goes into which board column — and hands it to the confirmation screen.
   * An import writes to a real board, so nothing is written before the user
   * has seen the mapping and approved it.
   */
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";   // so the same file can be re-picked
    if (!f) return;
    const boardId = people?.[0]?.boardId || boardInfo[0]?.id;
    const board = boardInfo.find((b) => b.id === boardId);
    if (!boardId || !board) { flash("לא נמצא לוח פעיל לייבוא"); return; }

    const parsed = parseDelimited(await f.text());
    const rows = parsed.filter((r) => r.some((c) => c !== ""));
    const emptyRows = parsed.length - rows.length;
    if (!rows.length) { flash("הקובץ ריק — לא נמצאו שורות"); return; }

    const cols = board.columns || [];
    const targets = importTargets(cols);
    const head = headRow(rows);
    const hasHeader = looksLikeHeader(head, targets);
    setPlan({
      fileName: f.name, boardId, boardName: board.name,
      rows, emptyRows, cols, targets,
      hasHeader, map: autoMap(head, targets, hasHeader),
    });
  }

  /** The user approved the mapping — only now do we write to Monday. */
  async function runImport(p: ImportPlan): Promise<ImportOutcome> {
    const { rows: payload, noName } = rowsToImport(p);
    const r = await fetch("/api/record", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "import", boardId: p.boardId, rows: payload.slice(0, IMPORT_LIMIT) }),
    });
    const d = await r.json();
    load();
    if (!d.ok) return { created: 0, failed: 0, noName, skippedEmpty: p.emptyRows, overCap: 0, failures: [], error: d.error || "הייבוא נכשל" };
    return {
      created: d.created || 0,
      failed: d.failed || 0,
      noName: noName + (d.noName || 0),
      skippedEmpty: p.emptyRows,
      overCap: Math.max(0, payload.length - IMPORT_LIMIT) + (d.overCap || 0),
      failures: d.failures || [],
    };
  }

  if (err) return <ErrBox msg={err} />;
  if (!people) return <Spinner label="קורא רשומות..." />;
  const tones: ToneMap = meta?.tones || {};
  const entity = meta?.entities[people[0]?.boardName || ""] || "רשומות";
  const shown = people.filter((p) => p.name.includes(q) || p.status.includes(q) || p.owner.includes(q));
  return (
    <div style={{ animation: "rise .4s both" }}>
      {toast && <div style={{ position: "fixed", top: 70, insetInlineStart: "50%", transform: "translateX(-50%)", background: C.ink, color: "#fff", padding: "10px 18px", borderRadius: 12, fontSize: 13, fontWeight: 600, zIndex: 60, boxShadow: "0 10px 30px rgba(0,0,0,.3)" }}>{toast}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div><h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 2px" }}>{entity}</h1><p style={{ fontSize: 12.5, color: C.muted, margin: 0 }}>{people.length} רשומות · עריכה נכתבת ישר ל-Monday{cov?.truncated ? ` · ${cov.note}` : ""}</p></div>
        <div style={{ marginInlineStart: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setAdding(true)} style={{ background: C.grape, color: "#fff", border: "none", borderRadius: 11, padding: "9px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>+ רשומה</button>
          <button onClick={() => fileRef.current?.click()} style={{ background: "#fff", color: C.grape, border: `1px solid ${C.grape}`, borderRadius: 11, padding: "9px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>העלאת רשימה</button>
          <input ref={fileRef} type="file" accept=".csv,.txt,.tsv" onChange={onFile} style={{ display: "none" }} />
          <div style={{ display: "flex", gap: 6, background: "#EDECF6", borderRadius: 11, padding: 3 }}>
            {(["cards", "list"] as const).map((v) => <button key={v} onClick={() => setView(v)} style={{ padding: "6px 13px", fontSize: 12.5, fontWeight: 700, border: "none", borderRadius: 9, background: view === v ? "#fff" : "transparent", color: view === v ? C.grape : C.muted, cursor: "pointer", fontFamily: "inherit" }}>{v === "cards" ? "כרטיסים" : "רשימה"}</button>)}
          </div>
        </div>
      </div>
      {adding && <AddRow onAdd={addRecord} onCancel={() => setAdding(false)} entity={entity} />}
      {plan && <ImportMapper plan={plan} setPlan={setPlan} onRun={runImport} />}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש..." style={{ width: "100%", maxWidth: 400, padding: "11px 14px", borderRadius: 12, border: "1px solid #E6E4F0", fontSize: 13.5, marginBottom: 16, outline: "none", fontFamily: "inherit" }} />
      {view === "cards" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
          {shown.slice(0, 60).map((p, i) => <PersonCard key={p.id} p={p} i={i} tone={tones[p.status]} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} onSaved={load} onDelete={delRecord} flash={flash} />)}
        </div>
      ) : (
        <div style={{ background: C.panel, border: "1px solid #ECEBF5", borderRadius: 16, overflow: "hidden" }}>
          {shown.slice(0, 100).map((p, i) => (
            <div key={p.id}>
              <button onClick={() => setOpen(open === p.id ? null : p.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 15px", background: open === p.id ? "#FAF9FE" : "#fff", border: "none", borderBottom: "1px solid #F4F3FB", cursor: "pointer", textAlign: "right", fontFamily: "inherit" }}>
                <Avatar name={p.name} i={i} sm />
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>{p.owner && <div style={{ fontSize: 11.5, color: C.muted }}>{p.owner}</div>}</div>
                {p.status && <Chip s={p.status} tone={tones[p.status]} />}
              </button>
              {open === p.id && <ProfileExpand p={p} onSaved={load} onDelete={delRecord} flash={flash} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
/* ===== list upload: read the file → SHOW THE MAPPING → approve → write =====
   Nothing here knows a single content word. A file column reaches a board
   column only by matching that board's own column titles, and the match is
   shown to the user for approval before one row is written. */

const IMPORT_LIMIT = 200;             // the server's protection cap, mirrored here
const NAME_TARGET = "__name__";       // the item's own name in Monday
/** Column TYPES a text cell cannot legally be written into: computed values,
    references to users/files/boards, and Monday-managed fields. */
const UNWRITABLE = ["name", "subtasks", "subitems", "button", "creation_log", "last_updated", "formula", "mirror", "board_relation", "dependency", "file", "doc", "auto_number", "progress", "integration", "time_tracking", "person", "people", "multiple-person", "vote"];

interface ImportCell { columnId: string; type: string; value: string }
interface ImportPlan {
  fileName: string; boardId: string; boardName: string;
  rows: string[][];     // every non-empty row of the file, header row included
  emptyRows: number;    // rows that were blank end to end
  cols: BoardCol[];     // the board's columns exactly as Monday reports them
  targets: BoardCol[];  // the subset a file column may be written into
  hasHeader: boolean;
  map: string[];        // per file column: a target id, or "" = do not import
}
interface ImportOutcome {
  created: number; failed: number; noName: number; skippedEmpty: number; overCap: number;
  failures: { name: string; reason: string }[]; error?: string;
}

/* The delimited-file reader that used to live here now lives in
   `@/lib/sheet-to-board`, unchanged, so /sheet can read a file with exactly
   the same rules this screen has always used. This screen imports it. */

/** The board columns a file column may be sent to, plus the record name itself. */
function importTargets(cols: BoardCol[]): BoardCol[] {
  const nameCol = cols.find((c) => c.type === "name");
  return [
    { id: NAME_TARGET, title: nameCol?.title || "שם הרשומה", type: "name" },
    ...cols.filter((c) => !UNWRITABLE.includes(c.type)),
  ];
}

/** The proposed mapping — a proposal only; the user sees it and may change it. */
function autoMap(first: string[], targets: BoardCol[], hasHeader: boolean): string[] {
  const byTitle = new Map(targets.map((t) => [normKey(t.title), t.id]));
  return first.map((h, i) => (hasHeader ? byTitle.get(normKey(h)) || "" : i === 0 ? NAME_TARGET : ""));
}

/** Turn the approved plan into the rows the API will write. */
function rowsToImport(p: ImportPlan): { rows: { name: string; values: ImportCell[] }[]; noName: number } {
  const data = p.hasHeader ? p.rows.slice(1) : p.rows;
  const nameIdx = p.map.indexOf(NAME_TARGET);
  const typeOf = (id: string) => p.cols.find((c) => c.id === id)?.type || "text";
  const rows: { name: string; values: ImportCell[] }[] = [];
  let noName = 0;
  for (const r of data) {
    const name = (nameIdx >= 0 ? r[nameIdx] || "" : "").trim();
    if (!name) { noName++; continue; }
    const values: ImportCell[] = [];
    p.map.forEach((target, i) => {
      if (!target || target === NAME_TARGET) return;
      const v = (r[i] || "").trim();
      if (v) values.push({ columnId: target, type: typeOf(target), value: v });
    });
    rows.push({ name, values });
  }
  return { rows, noName };
}

/** The confirmation screen. It is the whole point: an import writes to a real
    board, so the user reads what will happen before it happens. */
function ImportMapper({ plan, setPlan, onRun }: { plan: ImportPlan; setPlan: (p: ImportPlan | null) => void; onRun: (p: ImportPlan) => Promise<ImportOutcome> }) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<ImportOutcome | null>(null);

  const head = headRow(plan.rows);
  const header = plan.hasHeader ? head : head.map((_, i) => `עמודה ${i + 1}`);
  const data = plan.hasHeader ? plan.rows.slice(1) : plan.rows;
  const sample = data[0] || [];
  const { rows: ready, noName } = rowsToImport(plan);
  const dropped = header.map((h, i) => (plan.map[i] ? "" : h || `עמודה ${i + 1}`)).filter(Boolean);
  const dupe = plan.map.some((t, i) => t && plan.map.indexOf(t) !== i);
  const willImport = Math.min(ready.length, IMPORT_LIMIT);
  const blocked = plan.map.indexOf(NAME_TARGET) < 0
    ? "בחרו איזו עמודה בקובץ היא שם הרשומה — בלעדיה אי אפשר לייבא."
    : dupe ? "שתי עמודות בקובץ מכוונות לאותה עמודה בלוח — תקנו כדי להמשיך."
    : !ready.length ? "אין בקובץ אף שורה עם שם." : "";

  const setMapAt = (i: number, target: string) => setPlan({ ...plan, map: plan.map.map((t, j) => (j === i ? target : t)) });
  const toggleHeader = (v: boolean) => setPlan({ ...plan, hasHeader: v, map: autoMap(head, plan.targets, v) });
  async function approve() {
    setBusy(true);
    try { setOut(await onRun(plan)); } catch { setOut({ created: 0, failed: 0, noName: 0, skippedEmpty: 0, overCap: 0, failures: [], error: "הייבוא נכשל — לא הצלחתי לפנות לשרת" }); }
    finally { setBusy(false); }
  }

  const box: React.CSSProperties = { background: C.panel, borderRadius: 20, width: 640, maxWidth: "calc(100vw - 32px)", maxHeight: "86vh", overflowY: "auto", padding: 22, boxShadow: "0 30px 70px -20px rgba(40,30,90,.45)", animation: "pop .22s both" };
  const label: React.CSSProperties = { fontSize: 11, color: C.muted, marginBottom: 3 };

  return (
    <div dir="rtl" style={{ position: "fixed", inset: 0, background: "rgba(27,24,48,.45)", display: "grid", placeItems: "center", zIndex: 70, padding: 16 }}>
      <div style={box}>
        {out ? (
          <>
            <h2 style={{ fontSize: 19, fontWeight: 800, margin: "0 0 4px" }}>{out.error ? "הייבוא נכשל" : "סיכום הייבוא"}</h2>
            <p style={{ fontSize: 12.5, color: C.muted, margin: "0 0 14px" }}>{plan.fileName} ← {plan.boardName}</p>
            {out.error ? (
              <div style={{ background: C.coralL, color: "#D63A5C", borderRadius: 12, padding: "12px 14px", fontSize: 13, fontWeight: 600 }}>{out.error}</div>
            ) : (
              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                {[["נוצרו ב-Monday", out.created, C.teal, C.tealL], ["נכשלו", out.failed, C.coral, C.coralL]].map(([l, n, fg, bg]) => (
                  <div key={l as string} style={{ flex: 1, background: bg as string, borderRadius: 13, padding: 12 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: fg as string, fontVariantNumeric: "tabular-nums" }}>{n as number}</div>
                    <div style={{ fontSize: 11.5, color: C.muted }}>{l as string}</div>
                  </div>
                ))}
              </div>
            )}
            <ul style={{ margin: "0 0 12px", paddingInlineStart: 18, fontSize: 12.5, color: C.muted, lineHeight: 1.7 }}>
              {out.skippedEmpty > 0 && <li>{out.skippedEmpty} שורות ריקות בקובץ — דולגו.</li>}
              {out.noName > 0 && <li>{out.noName} שורות בלי שם — לא יובאו.</li>}
              {out.overCap > 0 && <li>{out.overCap} שורות מעבר לתקרת {IMPORT_LIMIT} השורות לייבוא — לא נשלחו. העלו אותן בקובץ נוסף.</li>}
              {dropped.length > 0 && <li>עמודות בקובץ שלא נכנסו ללוח: {dropped.join(" · ")}</li>}
            </ul>
            {out.failures.length > 0 && (
              <div style={{ border: `1px solid ${C.coral}40`, borderRadius: 13, padding: 12, marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: C.coral, marginBottom: 6 }}>מה נכשל ולמה</div>
                {out.failures.map((f, i) => <div key={i} style={{ fontSize: 12, color: C.ink, lineHeight: 1.6 }}><b>{f.name}</b> — <span style={{ color: C.muted }}>{f.reason}</span></div>)}
                {out.failed > out.failures.length && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 5 }}>ועוד {out.failed - out.failures.length} שורות שנכשלו.</div>}
              </div>
            )}
            <button onClick={() => setPlan(null)} style={{ background: C.grape, color: "#fff", border: "none", borderRadius: 11, padding: "10px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>סגירה</button>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: 19, fontWeight: 800, margin: "0 0 4px" }}>לפני שמייבאים — כך יתאימו העמודות</h2>
            <p style={{ fontSize: 12.5, color: C.muted, margin: "0 0 14px" }}>{plan.fileName} ← הלוח {plan.boardName}. שום דבר עוד לא נכתב ל-Monday.</p>

            <label style={{ display: "flex", alignItems: "center", gap: 8, background: C.grapeL, borderRadius: 12, padding: "9px 12px", marginBottom: 14, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              <input type="checkbox" checked={plan.hasHeader} onChange={(e) => toggleHeader(e.target.checked)} />
              השורה הראשונה בקובץ היא שורת כותרות
              <span style={{ color: C.muted, fontWeight: 500 }}>({plan.rows[0].slice(0, 3).join(" · ")})</span>
            </label>

            <div style={{ border: "1px solid #ECEBF5", borderRadius: 14, overflow: "hidden", marginBottom: 12 }}>
              {header.map((h, i) => {
                const target = plan.map[i];
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: i === header.length - 1 ? "none" : "1px solid #F4F3FB", background: target ? "#fff" : "#FBFAFE" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h || `עמודה ${i + 1}`}</div>
                      <div style={{ ...label, marginBottom: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sample[i] ? `לדוגמה: ${sample[i]}` : "ריקה בשורה הראשונה"}</div>
                    </div>
                    <span style={{ color: C.muted }}>←</span>
                    <select value={target} onChange={(e) => setMapAt(i, e.target.value)} style={{ width: 210, border: `1px solid ${target ? "#E1DBFC" : "#E6E4F0"}`, borderRadius: 10, padding: "8px 10px", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", color: target ? C.ink : C.muted, background: "#fff" }}>
                      <option value="">לא לייבא</option>
                      {plan.targets.map((t) => <option key={t.id} value={t.id}>{t.id === NAME_TARGET ? `${t.title} (שם הרשומה)` : t.title}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>

            <ul style={{ margin: "0 0 14px", paddingInlineStart: 18, fontSize: 12.5, color: C.muted, lineHeight: 1.7 }}>
              <li><b style={{ color: C.ink }}>{willImport}</b> רשומות ייווצרו בלוח.</li>
              {dropped.length > 0 && <li>לא נמצאו בלוח ולא ייובאו: {dropped.join(" · ")}</li>}
              {plan.emptyRows > 0 && <li>{plan.emptyRows} שורות ריקות — ידולגו.</li>}
              {noName > 0 && <li>{noName} שורות בלי שם — ידולגו.</li>}
              {ready.length > IMPORT_LIMIT && <li>הקובץ מכיל {ready.length} שורות; בייבוא אחד נכתבות עד {IMPORT_LIMIT}. השאר לא ייכתבו.</li>}
            </ul>

            {blocked && <div style={{ background: C.amberL, color: "#C77A00", borderRadius: 12, padding: "10px 13px", fontSize: 12.5, fontWeight: 700, marginBottom: 12 }}>{blocked}</div>}

            <div style={{ display: "flex", gap: 8 }}>
              <button disabled={busy || !!blocked} onClick={approve} style={{ background: blocked || busy ? "#C9C6DE" : C.grape, color: "#fff", border: "none", borderRadius: 11, padding: "11px 20px", fontSize: 13, fontWeight: 700, cursor: blocked || busy ? "default" : "pointer", fontFamily: "inherit" }}>{busy ? "מייבא ל-Monday..." : `אשרו וייבאו ${willImport} רשומות`}</button>
              <button disabled={busy} onClick={() => setPlan(null)} style={{ background: "#F0EFF6", color: C.muted, border: "none", borderRadius: 11, padding: "11px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>ביטול</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AddRow({ onAdd, onCancel, entity }: { onAdd: (n: string) => void; onCancel: () => void; entity: string }) {
  const [n, setN] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 14, background: C.grapeL, borderRadius: 13, padding: 10 }}>
      <input autoFocus value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onAdd(n)} placeholder={`שם ${entity.slice(0, -2) || "הרשומה"} החדשה...`} style={{ flex: 1, border: "1px solid #E1DBFC", borderRadius: 10, padding: "10px 13px", fontSize: 13.5, outline: "none", fontFamily: "inherit" }} />
      <button onClick={() => onAdd(n)} style={{ background: C.grape, color: "#fff", border: "none", borderRadius: 10, padding: "0 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>הוסיפו</button>
      <button onClick={onCancel} style={{ background: "#fff", color: C.muted, border: "none", borderRadius: 10, padding: "0 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>ביטול</button>
    </div>
  );
}
function PersonCard({ p, i, tone, open, onToggle, onSaved, onDelete, flash }: { p: Person; i: number; tone?: string; open: boolean; onToggle: () => void; onSaved: () => void; onDelete: (id: string) => void; flash: (m: string) => void }) {
  const c = pick(i);
  return (
    <div onClick={(e) => { if ((e.target as HTMLElement).tagName !== "INPUT" && (e.target as HTMLElement).tagName !== "BUTTON") onToggle(); }} style={{ background: C.panel, border: `1px solid ${open ? c.fg : "#ECEBF5"}`, borderRadius: 16, padding: 15, cursor: "pointer", boxShadow: open ? `0 10px 26px -12px ${c.fg}` : "0 3px 12px -6px rgba(60,50,120,.1)", transition: "all .18s", gridColumn: open ? "1 / -1" : "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <Avatar name={p.name} i={i} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
          <div style={{ fontSize: 11.5, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.owner || p.boardName}</div>
        </div>
        {p.status && <Chip s={p.status} tone={tone} />}
      </div>
      {open && <ProfileExpand p={p} inline onSaved={onSaved} onDelete={onDelete} flash={flash} />}
    </div>
  );
}
/* ===== the record's journey — dots on a line, ordered by the dates themselves.
   A stage's name is the board's own date-column title, so this component knows
   no stage, no phase and no word of the organisation's content. A date column
   the record has not filled in is a stage that has not happened yet: it stays
   on the line, faded, instead of vanishing. A board with no date column draws
   nothing at all. The order comes from the engine (BI.timeline). ===== */
const DATE_FMT = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric" });
const LINE_ON = "#C9BEF9", LINE_OFF = "#E4E1EF";

function Journey({ p }: { p: Person }) {
  const w = BI.timeline(
    { id: p.boardId, name: p.boardName, items: [], columns: p.fields.map((f) => ({ id: f.colId, title: f.title, type: f.type })) },
    { id: p.id, name: p.name, values: p.fields },
  );
  if (!w) return null;                       // no date column on this board
  const stages = (w.data as { stages: BI.Stage[] }).stages;
  const seg = (a: BI.Stage, b: BI.Stage) => (a.at !== null && b.at !== null ? LINE_ON : LINE_OFF);
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: C.grape, marginBottom: 9 }}>ציר הזמן</div>
      <div style={{ display: "flex", overflowX: "auto", paddingBottom: 2 }}>
        {stages.map((s, i) => (
          <div key={s.colId} style={{ position: "relative", flex: "1 0 94px", minWidth: 94, textAlign: "center", opacity: s.at === null ? 0.45 : 1 }}>
            {i > 0 && <span style={{ position: "absolute", insetInlineEnd: "50%", width: "50%", top: 6, height: 2, background: seg(s, stages[i - 1]) }} />}
            {i < stages.length - 1 && <span style={{ position: "absolute", insetInlineStart: "50%", width: "50%", top: 6, height: 2, background: seg(s, stages[i + 1]) }} />}
            <span style={{ position: "relative", display: "block", width: 12, height: 12, boxSizing: "border-box", margin: "1px auto 7px", borderRadius: "50%", background: s.at === null ? "#F4F3FB" : "#fff", border: `3px solid ${s.at === null ? "#C4BFD8" : C.grape}` }} />
            <div style={{ fontSize: 11.5, fontWeight: 800, color: s.at === null ? C.muted : C.ink, whiteSpace: "nowrap" }}>{s.at === null ? "טרם" : DATE_FMT.format(new Date(s.at))}</div>
            <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.3, padding: "0 4px" }}>{s.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
function ProfileExpand({ p, inline, onSaved, onDelete, flash }: { p: Person; inline?: boolean; onSaved: () => void; onDelete: (id: string) => void; flash: (m: string) => void }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const editable = p.fields.filter((f) => !["subtasks", "button", "creation_log", "last_updated", "formula", "mirror", "board_relation"].includes(f.type));
  async function save(f: PField, value: string) {
    if (value === f.text) return;
    const r = await fetch("/api/record", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "update", boardId: p.boardId, itemId: p.id, columnId: f.colId, columnType: f.type, value }) });
    const d = await r.json(); if (d.ok) { flash(`"${f.title}" עודכן ב-Monday ✓`); onSaved(); } else flash("שגיאה: " + d.error);
  }
  return (
    <div style={{ marginTop: inline ? 14 : 0, padding: inline ? "14px 0 0" : "16px 18px", background: inline ? "transparent" : "#FAF9FE", borderTop: inline ? "1px dashed #EEEDF5" : "none", animation: "fade .25s both" }}>
      <Journey p={p} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 9 }}>
        {editable.map((f, i) => <EditField key={i} f={f} onSave={save} />)}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        {!confirmDel ? (
          <button onClick={() => setConfirmDel(true)} style={{ background: "#fff", color: C.coral, border: `1px solid ${C.coral}55`, borderRadius: 10, padding: "8px 15px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>מחקי רשומה</button>
        ) : (
          <>
            <span style={{ fontSize: 12.5, color: C.coral, fontWeight: 700, alignSelf: "center" }}>למחוק מ-Monday לצמיתות?</span>
            <button onClick={() => onDelete(p.id)} style={{ background: C.coral, color: "#fff", border: "none", borderRadius: 10, padding: "8px 15px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>כן, מחקי</button>
            <button onClick={() => setConfirmDel(false)} style={{ background: "#F0EFF6", color: C.muted, border: "none", borderRadius: 10, padding: "8px 14px", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>ביטול</button>
          </>
        )}
      </div>
      <style>{`@keyframes fade{from{opacity:0}}`}</style>
    </div>
  );
}
function EditField({ f, onSave }: { f: PField; onSave: (f: PField, v: string) => void }) {
  const [v, setV] = useState(f.text);
  const [editing, setEditing] = useState(false);
  useEffect(() => setV(f.text), [f.text]);
  return (
    <div style={{ background: "#fff", border: `1px solid ${editing ? C.grape : "#ECEBF5"}`, borderRadius: 11, padding: "8px 11px" }}>
      <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 3 }}>{f.title}</div>
      <input
        value={v} onChange={(e) => setV(e.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={() => { setEditing(false); onSave(f, v); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        placeholder="—"
        style={{ width: "100%", border: "none", outline: "none", fontSize: 12.5, fontWeight: 600, background: "transparent", fontFamily: "inherit", color: C.ink }}
      />
    </div>
  );
}
// (the board's word for a row is derived server-side by terminology() and
//  delivered through /api/dashboard?meta=1 - the screen keeps no copy)
function Avatar({ name, i, sm }: { name: string; i: number; sm?: boolean }) {
  const c = pick(i); const s = sm ? 34 : 42;
  return <div style={{ width: s, height: s, borderRadius: 12, background: `linear-gradient(135deg,${c.fg},${c.fg}cc)`, color: "#fff", display: "grid", placeItems: "center", fontSize: sm ? 12 : 15, fontWeight: 800, flexShrink: 0 }}>{initials(name)}</div>;
}
function Chip({ s, tone }: { s: string; tone?: string }) { const c = toneStyle(tone); return <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: c.bg, color: c.fg, whiteSpace: "nowrap" }}>{s}</span>; }

/* ===== insights = "שמתי לב ש..." phrased discoveries (NOT charts) ===== */
interface Discovery { tone: string; icon: string; title: string; body: string; source: string }
function Insights({ names }: { names: string[] }) {
  const [items, setItems] = useState<Discovery[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setItems(null); fetch("/api/insights", { cache: "no-store" }).then((r) => r.json()).then((x) => x.error ? setErr(x.error) : setItems(x.insights)).catch(() => setErr("שגיאה")); }, []);
  if (err) return <ErrBox msg={err} />;
  if (!items) return <Spinner label="מגלה תובנות..." />;
  const toneMap: Record<string, { fg: string; bg: string }> = { rose: { fg: C.coral, bg: C.coralL }, amber: { fg: C.amber, bg: C.amberL }, grape: { fg: C.grape, bg: C.grapeL }, mint: { fg: C.teal, bg: C.tealL } };
  return (
    <div style={{ animation: "rise .4s both" }}>
      <div style={{ marginBottom: 18 }}><h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 2px" }}>שמתי לב ש...</h1><p style={{ fontSize: 12.5, color: C.muted, margin: 0 }}>גיליתי בעצמי ב-{names.join(" · ")} — כל תובנה מגובה במקור</p></div>
      {items.length === 0 ? (
        <div style={{ textAlign: "center", padding: 50, color: C.muted, background: C.panel, border: "1px solid #ECEBF5", borderRadius: 18 }}>הכל נראה תקין — לא זיהיתי פערים או חריגים בבורד. 👌</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((it, i) => { const c = toneMap[it.tone] || toneMap.grape;
            return <div key={i} style={{ background: C.panel, border: "1px solid #ECEBF5", borderRadius: 16, padding: "16px 18px", display: "flex", gap: 14, boxShadow: "0 4px 16px -8px rgba(60,50,120,.1)", animation: `rise .4s ${i * 0.05}s both` }}>
              <div style={{ width: 42, height: 42, borderRadius: 13, background: c.bg, color: c.fg, display: "grid", placeItems: "center", fontSize: 19, flexShrink: 0, fontWeight: 800 }}>{it.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 2 }}>{it.title}</div>
                <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>{it.body}</div>
                <div style={{ fontSize: 11, color: "#B4B2C6", marginTop: 7 }}>🔎 {it.source}</div>
              </div>
            </div>;
          })}
        </div>
      )}
    </div>
  );
}

/* ===== "תובנות" · the two board scans =====
   The discoveries above are computed on the server across every selected board.
   These two are not: they read ONE loaded board — its columns and its items —
   so this section loads that board itself.

   They are SECTIONS of "תובנות", not tabs. The eight tab names and the mode
   switch are locked by Meytal; nothing here adds to them. "תובנות" sits in
   "ניהול", so both get the purple accent, never the pink of "פעולות".

   Both are folded into <details> because together they are far longer than the
   discoveries they sit under. The hygiene scan opens by default — it is the one
   that can tell you something is wrong; the impact report is an export tool and
   waits to be asked for. */
function BoardScans({ boards, onAskAI }: { boards: BoardOpt[]; onAskAI: (q: string) => void }) {
  const [boardId, setBoardId] = useState(boards[0]?.id ?? "");
  const [loaded, setLoaded] = useState<{ id: string; board: MondayBoard; items: MondayItem[] } | null>(null);
  const [err, setErr] = useState<{ id: string; msg: string } | null>(null);

  /* No setState in the body of this effect: the load is started here and every
     answer lands in a callback, so a stale board is recognised by its id rather
     than cleared up front. */
  useEffect(() => {
    if (!boardId) return;
    let alive = true;
    loadBoard(boardId)
      .then((d) => { if (alive) setLoaded({ id: boardId, board: d.board, items: d.items }); })
      .catch((e) => { if (alive) setErr({ id: boardId, msg: e instanceof Error ? e.message : "לא הצלחנו לטעון את הבורד" }); });
    return () => { alive = false; };
  }, [boardId]);

  const ready = loaded && loaded.id === boardId ? loaded : null;
  const failed = err && err.id === boardId ? err : null;
  const busy = Boolean(boardId) && !ready && !failed;

  const head = (
    <div style={{ marginTop: 26, marginBottom: 14 }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 2px" }}>סריקות על בורד אחד</h2>
      <p style={{ fontSize: 12.5, color: C.muted, margin: 0 }}>שתי הסריקות האלה קוראות בורד אחד לעומק — בחרו על איזה.</p>
    </div>
  );

  if (!boardId) {
    return (
      <div style={{ animation: "rise .4s both" }}>
        {head}
        <Notice tone="calm" title="בחרו בורד" body="הסריקות האלה מבוססות על בורד מסוים." />
      </div>
    );
  }

  return (
    <div style={{ animation: "rise .4s both" }}>
      {head}
      {boards.length > 1 && <BoardPicker boards={boards} value={boardId} onPick={setBoardId} busy={busy} />}
      {busy && <Spinner label="טוען את הבורד..." />}
      {failed && <ErrBox msg={failed.msg} />}
      {ready && (
        <>
          <Scan title="התראות היגיינה" open>
            <AlertsPanel board={ready.board} items={ready.items} pc={C.grape} ac={C.muted} onAskAI={onAskAI} />
          </Scan>
          <Scan title="דוח אימפקט">
            <ImpactPanel board={ready.board} items={ready.items} pc={C.grape} ac={C.muted} />
          </Scan>
        </>
      )}
    </div>
  );
}

/** One folded section. The panel inside writes its own heading, so this only
    supplies the fold. */
function Scan({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} style={{ background: C.panel, border: "1px solid #ECEBF5", borderRadius: 18, padding: "4px 18px 4px", marginBottom: 12, boxShadow: "0 4px 16px -8px rgba(60,50,120,.1)" }}>
      <summary style={{ cursor: "pointer", listStyle: "none", padding: "14px 0", fontSize: 14.5, fontWeight: 800, color: C.grape, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.grape, flexShrink: 0 }} />
        {title}
      </summary>
      <div style={{ paddingBottom: 16 }}>{children}</div>
    </details>
  );
}

/* ===== "פעולות" =====
   Every screen here already existed; this mode only frames them. Three of them
   (עריכה קבוצתית, אוטומציות, בניית בורד) are the components /workspace renders,
   imported unchanged. צ׳אט־פקודות is the chat engine below, given a full panel
   instead of a bubble.

   Note the split in what they need: the bulk-edit and automations panels act on
   ONE board and take its columns and items as props, so this mode asks which
   board to work on. The chat and the builder do not — the chat reasons over all
   the boards the org selected, and the builder is creating a board that does
   not exist yet. */
const ACT = "#FF2D87";

function ActMode({ tab, boards, names, onBoardsChanged }: { tab: string; boards: BoardOpt[]; names: string[]; onBoardsChanged: () => void }) {
  const [boardId, setBoardId] = useState("");
  const [loaded, setLoaded] = useState<{ board: MondayBoard; items: MondayItem[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const chat = useChat();

  async function choose(id: string) {
    setBoardId(id); setBusy(true); setErr(null); setLoaded(null);
    try { const d = await loadBoard(id); setLoaded({ board: d.board, items: d.items }); }
    catch (e) { setErr(e instanceof Error ? e.message : "לא הצלחנו לטעון את הבורד"); }
    finally { setBusy(false); }
  }

  const shell = (kids: React.ReactNode) => (
    <div style={{ maxWidth: 1260, margin: "0 auto", padding: "20px 20px 60px" }}>{kids}</div>
  );

  if (tab === "chat") {
    return shell(
      <div style={{ background: C.panel, border: "1px solid #ECEBF5", borderRadius: 18, overflow: "hidden", display: "flex", flexDirection: "column", height: "calc(100vh - 190px)", minHeight: 420 }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #ECEBF5" }}>
          <div style={{ fontWeight: 800, fontSize: 15.5 }}>תגידו מה לעשות — ייעשה</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{names.length ? names.join(" · ") : "כל הבורדים שנבחרו"} · כל שינוי מוצג לאישור לפני שהוא נכתב ל-Monday</div>
        </div>
        <ChatCore chat={chat} ctx="הבורד" empty={<ChatIdeas onPick={(q) => chat.send(q)} />} />
      </div>
    );
  }

  if (tab === "build") {
    return shell(<SmartBuilder existingBoards={boards.map((b) => b.name)} onBoardCreated={onBoardsChanged} />);
  }

  /* bulk / autos / reports — need one loaded board */
  const picker = (
    <BoardPicker boards={boards} value={boardId} onPick={choose} busy={busy} />
  );
  if (!loaded) {
    return shell(
      <>
        {picker}
        {err && <Notice tone="bad" title="שגיאה" body={err} />}
        {!err && !busy && <Notice tone="calm" title="בחרו בורד" body={tab === "reports" ? "הדוח מופק מבורד מסוים." : "הפעולות במצב הזה נכתבות לבורד מסוים, ולכן צריך לבחור על איזה מהם לעבוד."} />}
      </>
    );
  }
  /* A board with no rows loads perfectly well - a board that "בניית בורד" just
     created IS this. It must not look broken, and it must not be a dead end:
     "עריכה קבוצתית" is the screen that can add the first record, so it stays
     open with a line explaining the empty table. Automations and reports have
     genuinely nothing to work on, so they say so instead of drawing an empty
     tool that looks like a bug. */
  const isEmpty = !loaded.items.length;
  if (isEmpty && tab !== "bulk") {
    return shell(
      <>
        {picker}
        <Notice
          tone="calm"
          title="הבורד עדיין ריק"
          body={tab === "reports"
            ? "אין בו רשומות, ולכן אין ממה להפיק דוח. הוסיפו רשומות בלשונית עריכה קבוצתית, וחזרו לכאן."
            : "אין בו רשומות, ולכן אין על מה להריץ אוטומציה. הוסיפו רשומות בלשונית עריכה קבוצתית, וחזרו לכאן."}
        />
      </>
    );
  }
  return shell(
    <>
      {picker}
      {isEmpty && <div style={{ marginBottom: 12 }}><Notice tone="calm" title="הבורד עדיין ריק" body="אין בו רשומות. הוסיפו את הראשונה בשדה ״+ פריט חדש״ שלמטה, והיא תיכתב ישירות ל-Monday." /></div>}
      {tab === "bulk" && <DataEditPanel board={loaded.board} items={loaded.items} apiToken="" boardId={boardId} pc={ACT} />}
      {tab === "autos" && <AutomationsPanel board={loaded.board} items={loaded.items} apiToken="" boardId={boardId} pc={ACT} />}
      {tab === "reports" && <ReportPanel board={loaded.board} items={loaded.items} pc={ACT} />}
    </>
  );
}

function BoardPicker({ boards, value, onPick, busy }: { boards: BoardOpt[]; value: string; onPick: (id: string) => void; busy: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: C.panel, border: "1px solid #ECEBF5", borderRadius: 14, padding: "12px 16px", marginBottom: 16 }}>
      <label htmlFor="act-board" style={{ fontSize: 13, fontWeight: 700 }}>עובדים על הבורד</label>
      <select
        id="act-board" value={value} onChange={(e) => onPick(e.target.value)} disabled={busy}
        style={{ flex: "1 1 240px", maxWidth: 420, border: "1px solid #E6E4F0", borderRadius: 10, padding: "9px 12px", fontSize: 13.5, fontFamily: "inherit", background: "#fff", color: C.ink }}
      >
        <option value="">— בחרו —</option>
        {boards.map((b) => <option key={b.id} value={b.id}>{b.items ? `${b.name} (${b.items})` : `${b.name} (ריק)`}</option>)}
      </select>
      {busy && <span style={{ fontSize: 12.5, color: C.muted }}>טוען…</span>}
    </div>
  );
}

function ChatIdeas({ onPick }: { onPick: (q: string) => void }) {
  const ideas = ["כמה יש בכל סטטוס?", "מי דורש תשומת לב?", "מה לא עודכן הכי הרבה זמן?", "אילו עמודות ריקות ברובן?"];
  return (
    <div style={{ padding: "10px 6px" }}>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 10, textAlign: "center" }}>נסחו פקודה או שאלה — או התחילו מאחת מאלה:</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {ideas.map((q) => (
          <button key={q} onClick={() => onPick(q)} style={{ textAlign: "start", background: C.panel, border: "1px solid #ECEBF5", borderRadius: 12, padding: "11px 14px", fontSize: 13, color: C.ink, cursor: "pointer", fontFamily: "inherit" }}>
            <span style={{ color: ACT, fontWeight: 900, marginInlineEnd: 8 }}>›</span>{q}
          </button>
        ))}
      </div>
    </div>
  );
}

function Notice({ tone, title, body, action }: { tone: "calm" | "bad"; title: string; body: string; action?: { href: string; label: string } }) {
  const bad = tone === "bad";
  return (
    <div style={{ background: C.panel, border: `1px solid ${bad ? C.coral + "55" : "#ECEBF5"}`, borderInlineStart: `4px solid ${bad ? C.coral : ACT}`, borderRadius: 16, padding: "18px 22px", maxWidth: 620 }}>
      <div style={{ fontSize: 15.5, fontWeight: 800, marginBottom: 6 }}>{title}</div>
      <p style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.7, margin: 0 }}>{body}</p>
      {action && (
        <a href={action.href} style={{ display: "inline-block", marginTop: 14, background: ACT, color: "#fff", borderRadius: 10, padding: "9px 18px", fontSize: 13.5, fontWeight: 700, textDecoration: "none" }}>{action.label}</a>
      )}
    </div>
  );
}

/* ===== command chat =====
   One chat engine, two frames: a floating bubble in "ניהול" (ask about what is
   on screen) and a full panel as the "צ׳אט־פקודות" tab in "פעולות" (tell it what
   to do). Both post to /api/ask and confirm every write before it reaches
   Monday — the confirmation card is the safety rule, not decoration. */
interface Action { type: string; personName: string; boardId: string; boardName: string; itemId: string; columnId: string; columnTitle: string; from: string; to: string; }
interface ChatMsg { role: "user" | "bot"; text: string; ai?: boolean; source?: string | null; action?: Action; done?: boolean; }

function useChat() {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState(""); const [busy, setBusy] = useState(false);
  async function send(q?: string) {
    const question = (q ?? input).trim(); if (!question) return;
    setInput(""); setMsgs((m) => [...m, { role: "user", text: question }]); setBusy(true);
    try { const r = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) }); const d = await r.json();
      setMsgs((m) => [...m, { role: "bot", text: d.answer || d.error, ai: d.ai, source: d.source, action: d.action }]);
    } catch { setMsgs((m) => [...m, { role: "bot", text: "שגיאת שרת" }]); } finally { setBusy(false); }
  }
  async function confirmAction(idx: number, a: Action) {
    setBusy(true);
    try {
      const r = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "apply", boardId: a.boardId, itemId: a.itemId, columnId: a.columnId, columnTitle: a.columnTitle, newStatus: a.to }) });
      const d = await r.json();
      setMsgs((m) => m.map((x, i) => i === idx ? { ...x, done: true } : x).concat([{ role: "bot", text: d.ok ? `✅ ${d.message} — עודכן ב-Monday!` : `❌ ${d.error}` }]));
      window.dispatchEvent(new CustomEvent("anyday-refresh"));
    } catch { setMsgs((m) => m.concat([{ role: "bot", text: "❌ העדכון נכשל" }])); } finally { setBusy(false); }
  }
  function cancelAction(idx: number) { setMsgs((m) => m.map((x, i) => i === idx ? { ...x, done: true } : x).concat([{ role: "bot", text: "ביטלתי — לא שונה כלום." }])); }
  return { msgs, input, setInput, busy, send, confirmAction, cancelAction };
}

type ChatApi = ReturnType<typeof useChat>;

/** Scroll area + composer. Whatever frames it decides the height. */
function ChatCore({ chat, ctx, empty }: { chat: ChatApi; ctx: string; empty?: React.ReactNode }) {
  const { msgs, input, setInput, busy, send, confirmAction, cancelAction } = chat;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight); }, [msgs, busy]);
  return (
    <>
      <div ref={ref} style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10, background: C.bg }}>
        {msgs.length === 0 && (empty ?? <div style={{ fontSize: 13, color: C.muted, textAlign: "center", padding: "20px 10px" }}>שאלו כל דבר על {ctx} — למשל &quot;כמה בכל סטטוס?&quot; או &quot;מי דורש תשומת לב?&quot;</div>)}
        {msgs.map((m, i) => <div key={i} style={{ alignSelf: m.role === "user" ? "flex-start" : "flex-end", maxWidth: "90%" }}>
          {m.role === "bot" && <div style={{ fontSize: 10, fontWeight: 800, color: C.grape, marginBottom: 3 }}>ANYDAY {m.ai && "· AI"}</div>}
          <div style={{ background: m.role === "user" ? "#fff" : C.grapeL, border: `1px solid ${m.role === "user" ? "#ECEBF5" : "#E1DBFC"}`, borderRadius: 14, padding: "9px 13px", fontSize: 13.5, lineHeight: 1.55 }} dangerouslySetInnerHTML={{ __html: m.text }} />
          {m.action && !m.done && (
            <div style={{ marginTop: 8, background: "#fff", border: `1.5px solid ${C.amber}`, borderRadius: 14, padding: 13 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.amber, marginBottom: 8 }}>מה ישתנה ב-Monday?</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 11, flexWrap: "wrap" }}>
                <b>{m.action.personName}</b>
                <span style={{ color: C.muted }}>· {m.action.columnTitle}:</span>
                <span style={{ background: "#F0EFF6", padding: "2px 8px", borderRadius: 7, textDecoration: "line-through", color: C.muted }}>{m.action.from}</span>
                <span>←</span>
                <span style={{ background: C.tealL, color: "#0B8F76", padding: "2px 8px", borderRadius: 7, fontWeight: 700 }}>{m.action.to}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => confirmAction(i, m.action!)} style={{ flex: 1, background: C.teal, color: "#fff", border: "none", borderRadius: 10, padding: "9px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>אשרי ועדכני ב-Monday</button>
                <button onClick={() => cancelAction(i)} style={{ background: "#F0EFF6", color: C.muted, border: "none", borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>ביטול</button>
              </div>
            </div>
          )}
          {m.source && <div style={{ fontSize: 10, color: "#B4B2C6", marginTop: 3 }}>🔎 {m.source}</div>}
        </div>)}
        {busy && <div style={{ alignSelf: "flex-end", display: "flex", gap: 4, padding: "9px 13px", background: C.grapeL, borderRadius: 14 }}>{[0, 1, 2].map((i) => <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: C.grape, animation: `bob 1.2s ${i * .15}s infinite` }} />)}</div>}
      </div>
      <div style={{ padding: 12, borderTop: "1px solid #ECEBF5", display: "flex", gap: 8 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder={`שאלו על ${ctx}...`} style={{ flex: 1, border: "1px solid #E6E4F0", borderRadius: 12, padding: "10px 13px", fontSize: 13.5, outline: "none", fontFamily: "inherit" }} />
        <button onClick={() => send()} aria-label="שליחה" style={{ width: 42, height: 42, borderRadius: 12, border: "none", background: C.grape, color: "#fff", fontSize: 17, cursor: "pointer" }}>↑</button>
      </div>
      <style>{`@keyframes pop{from{opacity:0;transform:translateY(12px) scale(.97)}}@keyframes bob{0%,60%,100%{opacity:.35;transform:translateY(0)}30%{opacity:1;transform:translateY(-4px)}}`}</style>
    </>
  );
}

/* ===== floating context chat ("ניהול") ===== */
function ChatFab({ chat, open, setOpen, tab, names }: { chat: ChatApi; open: boolean; setOpen: (v: boolean) => void; tab: string; names: string[] }) {
  const ctx = tab === "people" ? "המשתתפים" : tab === "insights" ? "התובנות" : "הלוח";
  if (!open) return <button onClick={() => setOpen(true)} style={{ position: "fixed", bottom: 24, insetInlineStart: 24, height: 54, padding: "0 22px", borderRadius: 999, border: "none", background: `linear-gradient(135deg,${C.grape},${C.coral})`, color: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer", boxShadow: `0 14px 34px -10px ${C.grape}`, display: "flex", alignItems: "center", gap: 9, fontFamily: "inherit", zIndex: 40 }}>💬 שאלו על {ctx}</button>;
  return (
    <div style={{ position: "fixed", bottom: 24, insetInlineStart: 24, width: 380, maxWidth: "calc(100vw - 40px)", height: 520, maxHeight: "78vh", background: C.panel, borderRadius: 22, boxShadow: "0 30px 70px -20px rgba(40,30,90,.4)", display: "flex", flexDirection: "column", overflow: "hidden", zIndex: 40, animation: "pop .25s both" }}>
      <div style={{ padding: "14px 16px", background: `linear-gradient(135deg,${C.grape},${C.coral})`, color: "#fff", display: "flex", alignItems: "center", gap: 9 }}>
        <div style={{ fontWeight: 800, fontSize: 14.5 }}>🟣 שאלו על {ctx}</div>
        <div style={{ fontSize: 11, opacity: .85 }}>{names.join(" · ")}</div>
        <button onClick={() => setOpen(false)} aria-label="סגירה" style={{ marginInlineStart: "auto", background: "rgba(255,255,255,.2)", border: "none", color: "#fff", width: 28, height: 28, borderRadius: 8, cursor: "pointer", fontSize: 15 }}>✕</button>
      </div>
      <ChatCore chat={chat} ctx={ctx} />
    </div>
  );
}

/* ===== helpers ===== */
function useCountUp(target: number) {
  const [n, setN] = useState(0);
  useEffect(() => { if (matchMedia("(prefers-reduced-motion:reduce)").matches) { setN(target); return; }
    let raf = 0; const t0 = performance.now(), dur = 900;
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / dur); setN(Math.round((1 - Math.pow(1 - p, 3)) * target)); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [target]);
  return n;
}
function Spinner({ label }: { label: string }) { return <div style={{ textAlign: "center", padding: 60 }}><div style={{ width: 40, height: 40, border: `3px solid ${C.grapeL}`, borderTopColor: C.grape, borderRadius: "50%", margin: "0 auto 14px", animation: "spin .8s linear infinite" }} /><p style={{ fontSize: 14, color: C.muted, fontWeight: 600 }}>{label}</p><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>; }
function ErrBox({ msg }: { msg: string }) { return <div style={{ maxWidth: 440, margin: "40px auto", background: C.panel, border: `1px solid ${C.coral}40`, borderRadius: 16, padding: 24, textAlign: "center" }}><div style={{ fontSize: 30, marginBottom: 8 }}>🔌</div><p style={{ fontSize: 14, color: C.muted, margin: 0 }}>{msg}</p></div>; }
function initials(name: string) { const p = (name || "").trim().split(/\s+/); return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).slice(0, 2) || "?"; }
