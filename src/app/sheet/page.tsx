"use client";

/**
 * /sheet — a dashboard from a sheet you already have, with no account at all.
 *
 * ── Two ways in, each with its own honest promise ──
 * A FILE never leaves the browser: read with `File.text()`, parsed by
 * `@/lib/sheet-to-board`, handed straight to `board-intelligence` — all inside
 * this tab. No upload, no cookie, no localStorage; closing the tab deletes it.
 * A GOOGLE SHEETS LINK is fetched by our own /api/sheets, because Google's CSV
 * export sends no CORS headers and a browser cannot read it directly. The
 * bytes pass through the server and are not stored or logged; parsing still
 * happens HERE, by the same reader a dropped file gets. The pill in the top
 * bar states whichever promise applies.
 *
 * A link is also what makes this screen near-live: "משיכה מחדש" re-reads the
 * sheet as it is right now, keeping any type the user corrected (column ids
 * are positional, so they survive a refetch).
 *
 * ── Looking vs. saving (הכרעת מיטל 4.9) ──
 * Everything above describes LOOKING, which still stores nothing and needs no
 * account. SAVING is the one door out of that: a dashboard that must keep
 * working when the tab is shut has to carry its spreadsheet with it, because
 * an automation reads when nobody is looking. So a save stores the sheet, the
 * SaveCard says so in those words before the button, and deleting the
 * dashboard deletes the data with it.
 *
 * ── What this screen is still NOT ──
 * A view, not a hand on the wheel. Nothing is written BACK to the source: a
 * file has nowhere to write to, and a Google Sheet is read-only to us.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as BI from "@/lib/board-intelligence";
import { readSheet, planToBoard, type SheetPlan, type SheetType } from "@/lib/sheet-to-board";
import { sliceWidget, type SliceSpec } from "@/lib/slice";
import { bucketOf } from "@/lib/board-profile";
import { SliceBuilder, describe as describeSlice, type SliceCol } from "@/components/live/SliceBuilder";
import { SliceBody, type SliceData } from "@/components/live/SliceTable";
import { KpiTile, ChartCard } from "@/components/live/LiveWidgets";
import { buildLiveBoard } from "@/lib/live-board";
import { profileBoard, type BoardPrefs } from "@/lib/board-profile";
import { useUser } from "@/lib/use-user";

/* ── the palette of "לוח חי", so a sheet dashboard and a board dashboard are
      recognisably the same product ── */
const C = {
  bg: "#F4F3FB", panel: "#FFFFFF", ink: "#1B1830", muted: "#7C7A93", line: "#ECEBF5",
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

const FONT = "Rubik, Assistant, Heebo, system-ui, sans-serif";
const card = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 18, boxShadow: "0 4px 16px -8px rgba(60,50,120,.14)" } as const;

/** What each inferred type is called on screen, and why it was chosen. The
 *  wording describes the SHAPE that was measured — never the column's name. */
const TYPE_LABEL: Record<SheetType, string> = {
  status: "קטגוריה",
  date: "תאריך",
  numbers: "מספר",
  text: "טקסט",
};
const TYPE_ORDER: SheetType[] = ["status", "date", "numbers", "text"];

/* ═══════════════════════════════ the screen ═══════════════════════════════ */

type Stage = "drop" | "confirm" | "dash";

/** Where the current plan came from — it decides the privacy pill, and whether
 *  a refetch is even possible. */
type Source = { kind: "file" } | { kind: "link"; url: string } | { kind: "demo"; key: string };

/**
 * Ready-made demos, opened by `/sheet?demo=<key>` — one link that lands a
 * stranger on a finished dashboard with nothing to upload, no account and no
 * Monday. Built for showing the product to someone who has no data of their
 * own yet.
 *
 * Each file is an ANONYMISED TWIN of a real board: the same columns, the same
 * categories in the same proportions, the same share of blanks — and not one
 * real person. Identifier columns (ת"ז, טלפון) are not reproduced at all.
 *
 * A fixed registry, never a path from the URL: `?demo=` chooses one of these
 * and can express nothing else.
 */
const DEMOS: Record<string, { file: string; title: string }> = {
  school: { file: "/demo/alumni-school.csv", title: "מאגר בוגרים — בית ספר (הדגמה)" },
  alumni: { file: "/demo/alumni-all.csv", title: "כלל הבוגרים (הדגמה)" },
};

/** Resolve `?demo=` and read the file. Returns null when no demo was asked for. */
async function loadDemo(): Promise<{ plan?: SheetPlan; key?: string; err?: string } | null> {
  const key = new URLSearchParams(window.location.search).get("demo");
  if (!key) return null;
  const demo = DEMOS[key];
  if (!demo) return { err: "ההדגמה המבוקשת לא קיימת." };
  try {
    const res = await fetch(demo.file);
    if (!res.ok) return { err: "לא הצלחתי לטעון את נתוני ההדגמה." };
    const plan = readSheet(demo.title, await res.text());
    if (plan.empty) return { err: "נתוני ההדגמה ריקים." };
    return { plan, key };
  } catch {
    return { err: "לא הצלחתי לטעון את נתוני ההדגמה." };
  }
}

export default function SheetPage() {
  const [plan, setPlan] = useState<SheetPlan | null>(null);
  const [types, setTypes] = useState<Record<string, SheetType>>({});
  const [stage, setStage] = useState<Stage>("drop");
  const [err, setErr] = useState<string | null>(null);
  const [source, setSource] = useState<Source>({ kind: "file" });
  const [busy, setBusy] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  /* The sheet's raw text, kept only so it can be SAVED on request (הכרעת
     מיטל 4.9). Nothing reads it otherwise, and it goes nowhere until a person
     presses save and is told, in those words, that it will be stored. */
  const [csv, setCsv] = useState("");

  /* The plan the user actually approved: the guess, plus any type she corrected.
     Rebuilt on every render from the same inputs, so nothing is cached behind
     her back and a correction is visible immediately. */
  const finalPlan = useMemo<SheetPlan | null>(
    () => (plan ? { ...plan, columns: plan.columns.map((c) => ({ ...c, type: types[c.id] || c.type })) } : null),
    [plan, types],
  );

  function reset() { setPlan(null); setTypes({}); setStage("drop"); setErr(null); setSource({ kind: "file" }); setBusy(false); setFetchedAt(null); setCsv(""); }

  /* A `?demo=` link opens straight on the dashboard: the whole point is that
     the visitor does nothing at all. Read from window rather than
     useSearchParams so this page stays statically prerenderable. */
  useEffect(() => {
    let alive = true;
    loadDemo().then((r) => {
      if (!alive || !r) return;
      if (r.err) { setErr(r.err); return; }
      setPlan(r.plan!); setTypes({}); setCsv(""); setSource({ kind: "demo", key: r.key! }); setStage("dash");
    });
    return () => { alive = false; };
  }, []);

  /** The link path's single network call: our own /api/sheets brings the CSV,
   *  and the SAME `readSheet` that reads a dropped file reads it here. */
  async function fetchLink(url: string): Promise<SheetPlan | null> {
    const r = await fetch("/api/sheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    const d = await r.json().catch(() => ({ error: "תשובה לא צפויה מהשרת." }));
    if (!r.ok || d.error) { setErr(d.error || "לא הצלחתי למשוך את הגיליון."); return null; }
    const p = readSheet(d.title || "גיליון Google", d.csv || "");
    if (p.empty) { setErr("לא נמצאו נתונים בגיליון — כל השורות ריקות."); return null; }
    setCsv(String(d.csv || ""));
    return p;
  }

  async function fromLink(url: string) {
    setErr(null); setBusy(true);
    try {
      const p = await fetchLink(url);
      if (p) { setPlan(p); setTypes({}); setSource({ kind: "link", url }); setFetchedAt(new Date()); setStage("confirm"); }
    } finally { setBusy(false); }
  }

  /** Re-read the sheet as it is right now. Type corrections are kept: column
   *  ids are positional, so they still point at the same columns. */
  async function refresh() {
    if (source.kind !== "link") return;
    setErr(null); setBusy(true);
    try { const p = await fetchLink(source.url); if (p) { setPlan(p); setFetchedAt(new Date()); } }
    finally { setBusy(false); }
  }

  /**
   * Reading a file. `f.text()` resolves inside this tab — the bytes go nowhere
   * else. The only fetch() in this file belongs to the LINK path, and it talks
   * to our own /api/sheets and to nobody else.
   */
  async function accept(f: File) {
    setErr(null); setSource({ kind: "file" }); setFetchedAt(null);
    if (/\.(xlsx|xls|ods)$/i.test(f.name)) {
      setErr("קובץ אקסל עדיין לא נקרא כאן. בתוך אקסל: קובץ ← שמירה בשם ← CSV UTF-8, ואז לגרור לכאן את הגיליון שנשמר.");
      return;
    }
    if (f.size > 20 * 1024 * 1024) { setErr("הקובץ גדול מ-20MB. הדפדפן יתקשה לקרוא אותו כאן."); return; }
    let text = "";
    try { text = await f.text(); } catch { setErr("לא הצלחתי לקרוא את הקובץ."); return; }
    const p = readSheet(f.name, text);
    if (p.empty) { setErr("לא נמצאו נתונים בקובץ — כל השורות ריקות."); return; }
    setPlan(p); setTypes({}); setCsv(text); setStage("confirm");
  }

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: FONT }}>
      <TopBar onReset={plan ? reset : undefined} fileName={plan?.fileName} live={source.kind === "link"} demo={source.kind === "demo"} />
      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "26px 20px 70px" }}>
        {stage === "drop" && <DropStage onFile={accept} onLink={fromLink} busy={busy} err={err} />}
        {stage === "confirm" && finalPlan && (
          <ConfirmStage
            plan={finalPlan}
            onType={(id, t) => setTypes((p) => ({ ...p, [id]: t }))}
            onGo={() => setStage("dash")}
            onBack={reset}
          />
        )}
        {stage === "dash" && finalPlan && (
          <DashStage
            plan={finalPlan} onBack={() => setStage("confirm")} onReset={reset}
            live={source.kind === "link" ? { busy, fetchedAt, err, onRefresh: refresh } : undefined}
            save={csv ? { csv, types, source } : undefined}
          />
        )}
      </main>
    </div>
  );
}

function TopBar({ onReset, fileName, live, demo }: { onReset?: () => void; fileName?: string; live?: boolean; demo?: boolean }) {
  return (
    <header style={{ height: 58, background: C.panel, borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 14, padding: "0 22px", position: "sticky", top: 0, zIndex: 20 }}>
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", color: C.ink }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: `linear-gradient(135deg,${C.grape},#FF2D87)`, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 16 }}>A</div>
        <div style={{ fontWeight: 800, fontSize: 18 }}>Any<span style={{ color: C.grape }}>Day</span></div>
      </Link>
      <span style={{ fontSize: 12.5, color: C.muted, fontWeight: 600, borderInlineStart: `1px solid ${C.line}`, paddingInlineStart: 14 }}>
        דשבורד מגיליון
      </span>
      {fileName && <span style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>{fileName}</span>}
      <div style={{ marginInlineStart: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        <PrivacyPill live={live} demo={demo} />
        {onReset && <button onClick={onReset} style={btnGhost}>מקור אחר</button>}
      </div>
    </header>
  );
}

/** The promise, said in the chrome and not only in the small print — and said
 *  per source, because the two paths genuinely differ. */
function PrivacyPill({ live, demo }: { live?: boolean; demo?: boolean }) {
  // A demo must never be mistaken for somebody's real data. It says so in the
  // chrome, in its own colour, before anyone reads a single number.
  if (demo) {
    return (
      <span style={{ fontSize: 11.5, fontWeight: 700, color: "#9A5B00", background: C.amberL, borderRadius: 999, padding: "5px 11px", whiteSpace: "nowrap" }}>
        נתוני הדגמה — אנשים בדויים
      </span>
    );
  }
  // The pill describes LOOKING, which is still stored nowhere. Saving stores
  // the data, and that is stated at the moment of saving rather than watered
  // down here — a promise that has to hedge for a thing you have not done yet
  // teaches people to stop reading it.
  return (
    <span style={{ fontSize: 11.5, fontWeight: 700, color: "#0B8F76", background: C.tealL, borderRadius: 999, padding: "5px 11px", whiteSpace: "nowrap" }}>
      {live ? "🔒 לא נשמר אצלנו דבר" : "🔒 הקובץ נשאר בדפדפן שלך"}
    </span>
  );
}

/* ── stage 1: choose a file ─────────────────────────────────────────────── */

function DropStage({ onFile, onLink, busy, err }: { onFile: (f: File) => void; onLink: (url: string) => void; busy: boolean; err: string | null }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [link, setLink] = useState("");

  return (
    <div style={{ maxWidth: 620, margin: "24px auto 0" }}>
      <h1 style={{ fontSize: 27, fontWeight: 800, margin: "0 0 8px", letterSpacing: "-.02em" }}>
        גיליון אחד, ומיד דשבורד
      </h1>
      <p style={{ fontSize: 14.5, color: C.muted, lineHeight: 1.7, margin: "0 0 22px" }}>
        גררו קובץ CSV — או הדביקו קישור לגיליון Google. המערכת קוראת, מזהה לבד מה יש
        בכל עמודה, ובונה תמונת מצב. בלי חשבון ובלי הרשמה.
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
        style={{
          ...card, borderStyle: "dashed", borderWidth: 2,
          borderColor: over ? C.grape : "#D9D6EC", background: over ? C.grapeL : C.panel,
          padding: "42px 24px", textAlign: "center", transition: "all .18s",
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 10 }}>📄</div>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>גררו קובץ לכאן</div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 18 }}>CSV או TSV · עד 20MB</div>
        <button onClick={() => ref.current?.click()} style={btnPrimary}>בחירת קובץ מהמחשב</button>
        <input
          ref={ref} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
          onChange={(e) => { const f = e.target.files?.[0]; if (ref.current) ref.current.value = ""; if (f) onFile(f); }}
          style={{ display: "none" }}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0 14px" }}>
        <span style={{ flex: 1, height: 1, background: C.line }} />
        <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>או מגיליון Google — בלי להוריד קובץ</span>
        <span style={{ flex: 1, height: 1, background: C.line }} />
      </div>

      <div style={{ ...card, padding: "16px 18px" }}>
        <form onSubmit={(e) => { e.preventDefault(); if (link.trim() && !busy) onLink(link.trim()); }} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={link} onChange={(e) => setLink(e.target.value)} dir="ltr" inputMode="url"
            placeholder="https://docs.google.com/spreadsheets/d/…" aria-label="קישור לגיליון Google Sheets"
            style={{ flex: 1, minWidth: 220, fontFamily: FONT, fontSize: 13, padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.panel, color: C.ink, outline: "none" }}
          />
          <button type="submit" disabled={busy || !link.trim()} style={{ ...btnPrimary, opacity: busy || !link.trim() ? .55 : 1, cursor: busy ? "wait" : "pointer" }}>
            {busy ? "מושך…" : "משיכה מהגיליון"}
          </button>
        </form>
        <div style={{ marginTop: 9, fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
          הגיליון צריך להיות משותף כ״כל מי שיש לו הקישור״. במסלול הזה הנתונים עוברים דרך
          השרת שלנו בדרך אליכם — ולא נשמרים בו. ומהדשבורד אפשר למשוך מחדש בכל רגע,
          אז התמונה נשארת עדכנית בלי להוריד קובץ שוב.
        </div>
      </div>

      {err && (
        <div style={{ ...card, borderColor: `${C.coral}55`, padding: "13px 16px", marginTop: 14, fontSize: 13.5, lineHeight: 1.7 }}>
          {err}
        </div>
      )}

      <div style={{ ...card, padding: "16px 18px", marginTop: 18 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 8 }}>מה קורה לקובץ שלכם</div>
        <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 13, color: C.muted, lineHeight: 1.95 }}>
          <li>הוא נקרא בתוך הדפדפן. הוא לא נשלח לשרת שלנו ולא נשמר בשום מקום.</li>
          <li>סגירת הלשונית מוחקת הכול. אין מה לבטל ואין מה למחוק אחר כך.</li>
          <li>זו <b style={{ color: C.ink }}>תצוגה בלבד</b>: אין עריכה, אין כתיבה חזרה לקובץ, אין אוטומציות ואין דיוור.</li>
        </ul>
      </div>

      <div style={{ marginTop: 14, fontSize: 12.5, color: C.muted, textAlign: "center" }}>
        רוצים מערכת חיה שמתעדכנת לבד? <Link href="/app" style={{ color: C.grape, fontWeight: 700 }}>מחברים את Monday</Link>
      </div>
    </div>
  );
}

/* ── stage 2: what was understood, and a chance to correct it ───────────── */

function ConfirmStage({ plan, onType, onGo, onBack }: {
  plan: SheetPlan; onType: (id: string, t: SheetType) => void; onGo: () => void; onBack: () => void;
}) {
  /* Every decision the reader took, said out loud. A number nobody can explain
     is worth less than no number (RULES §3). */
  const facts: string[] = [
    plural(plan.rows.length, "שורה אחת נקראה", "שורות נקראו"),
    plural(plan.columns.length, "עמודה אחת", "עמודות"),
  ];
  if (plan.headerLine) facts.push(`הכותרות זוהו בשורה ${plan.headerLine}`);
  else facts.push("לא נמצאה שורת כותרות — השורה הראשונה נקראה כנתונים, והעמודות קיבלו שמות גנריים");
  if (plan.preambleLines) facts.push(plural(plan.preambleLines, "שורה אחת מעל הטבלה דולגה", "שורות מעל הטבלה דולגו"));
  if (plan.blankRows) facts.push(plural(plan.blankRows, "שורה ריקה אחת לא נספרה", "שורות ריקות לא נספרו"));
  if (plan.droppedColumns.length) facts.push(plural(plan.droppedColumns.length, "עמודה אחת ריקה לגמרי הושמטה", "עמודות ריקות לגמרי הושמטו"));

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 23, fontWeight: 800, margin: "0 0 6px" }}>זה מה שזיהיתי בנתונים</h1>
      <p style={{ fontSize: 13.5, color: C.muted, margin: "0 0 16px", lineHeight: 1.7 }}>
        הטיפוס של כל עמודה נקבע לפי <b style={{ color: C.ink }}>צורת הנתונים</b> שבתוכה — לא לפי שם העמודה.
        זה ניחוש, ואפשר לתקן אותו כאן לפני שמחשבים משהו.
      </p>

      <div style={{ ...card, padding: "14px 18px", marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "7px 10px" }}>
          {facts.map((f, i) => (
            <span key={i} style={{ fontSize: 12.5, fontWeight: 600, background: "#F4F3FB", borderRadius: 999, padding: "5px 12px", color: C.ink }}>{f}</span>
          ))}
        </div>
        {plan.droppedColumns.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
            הושמטו: {plan.droppedColumns.join(" · ")}
          </div>
        )}
      </div>

      <div style={{ ...card, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#FAFAFE", color: C.muted, fontSize: 11.5, fontWeight: 700 }}>
              <th style={th}>עמודה</th>
              <th style={th}>מלאות</th>
              <th style={th}>ערכים שונים</th>
              <th style={th}>למה כך</th>
              <th style={th}>טיפוס</th>
            </tr>
          </thead>
          <tbody>
            {plan.columns.map((c) => (
              <tr key={c.id} style={{ borderTop: `1px solid ${C.line}` }}>
                <td style={{ ...td, fontWeight: 700 }}>
                  {c.title}
                  {c.index === plan.nameIndex && <span style={{ fontSize: 10.5, color: C.grape, background: C.grapeL, borderRadius: 999, padding: "2px 7px", marginInlineStart: 7 }}>שם הרשומה</span>}
                </td>
                <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: C.muted }}>
                  {c.filled} מתוך {plan.rows.length}
                </td>
                <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: C.muted }}>{c.unique}</td>
                <td style={{ ...td, color: C.muted, fontSize: 12, lineHeight: 1.6 }}>{whyText(c.type, c.identifier, c.filled, c.unique)}</td>
                <td style={td}>
                  <select
                    value={c.type} onChange={(e) => onType(c.id, e.target.value as SheetType)}
                    aria-label={`טיפוס העמודה ${c.title}`}
                    style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 700, padding: "6px 9px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.panel, color: C.ink }}
                  >
                    {TYPE_ORDER.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 18, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={onGo} style={btnPrimary}>בניית הדשבורד</button>
        <button onClick={onBack} style={btnGhost}>מקור אחר</button>
        <span style={{ fontSize: 12, color: C.muted }}>עדיין לא חושב שום דבר.</span>
      </div>
    </div>
  );
}

/** Hebrew does not say "1 שורות". One of anything gets its own sentence. */
function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n.toLocaleString("he-IL")} ${many}`;
}

/** Says which measurement produced this type. Numbers only — no words about
 *  the data itself, because none were read. */
function whyText(type: SheetType, identifier: boolean, filled: number, unique: number): string {
  if (identifier) return `כל ${filled} הערכים מספריים, ייחודיים ובאורך אחיד — זה מזהה, לא מדד. לא יחושבו עליו סכום או ממוצע.`;
  if (type === "date") return "כמעט כל הערכים נפרשים כתאריך.";
  if (type === "numbers") return "כמעט כל הערכים מספריים ומשתנים — אפשר לסכם אותם.";
  if (type === "status") return `${plural(unique, "ערך אחד בלבד, חוזר", "ערכים בלבד, חוזרים")} על פני ${filled} שורות — קבוצה סגורה.`;
  return "הערכים ברובם ייחודיים — טקסט חופשי.";
}

/* ── stage 3: the dashboard, straight from the engine ───────────────────── */

type LiveInfo = { busy: boolean; fetchedAt: Date | null; err: string | null; onRefresh: () => void };

/** What a save needs: the raw text, the corrections, and where it came from.
 *  Absent for a demo — fabricated people are not worth an org's storage. */
type SaveInfo = { csv: string; types: Record<string, SheetType>; source: Source };

function DashStage({ plan, onBack, onReset, live, save }: {
  plan: SheetPlan; onBack: () => void; onReset: () => void; live?: LiveInfo; save?: SaveInfo;
}) {
  const board = useMemo(() => planToBoard(plan), [plan]);

  /* The same computation a connected Monday board gets (בקשת מיטל 2.9), run
     here in the tab: the profile ranks the columns, the relevance layer drops
     what tells no story, and the user's own ⭐/✕ and purpose sentence override
     both. The only difference from /app is where the preferences live — there
     a database, here this tab. Closing it forgets them, exactly like the file. */
  const [prefs, setPrefs] = useState<BoardPrefs>({});
  const { kpis, charts, more, attention } = useMemo(
    () => buildLiveBoard([{ board, prefs }]), [board, prefs]
  );

  const hasTimeline = useMemo(() => board.items.length > 0 && BI.timeline(board, board.items[0]) !== null, [board]);

  const toggleKey = (field: "pinnedWidgets" | "hiddenWidgets", key: string) =>
    setPrefs((p) => {
      const cur = new Set(p[field] ?? []);
      if (cur.has(key)) cur.delete(key); else cur.add(key);
      // Pinning something that was hidden un-hides it: the two marks are
      // opposite intentions, and holding both would be a contradiction.
      const other = field === "pinnedWidgets" ? "hiddenWidgets" : "pinnedWidgets";
      const otherSet = new Set(p[other] ?? []);
      otherSet.delete(key);
      return { ...p, [field]: [...cur], [other]: [...otherSet] };
    });

  return (
    <div>
      <ViewOnlyBanner live={!!live} />

      {live?.err && (
        <div style={{ ...card, borderColor: `${C.coral}55`, padding: "11px 15px", marginBottom: 14, fontSize: 12.5, lineHeight: 1.7 }}>
          המשיכה האחרונה נכשלה, והמוצג הוא המצב הקודם. {live.err}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", margin: "0 0 14px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{board.name}</h1>
        <span style={{ fontSize: 12.5, color: C.muted }}>
          {plural(board.items.length, "שורה אחת", "שורות")} · {plural(board.columns.length, "עמודה אחת", "עמודות")}
          {plan.headerLine ? ` · כותרות משורה ${plan.headerLine}` : " · ללא שורת כותרות"}
          {plan.blankRows ? ` · ${plural(plan.blankRows, "שורה ריקה אחת דולגה", "שורות ריקות דולגו")}` : ""}
          {plan.droppedColumns.length ? ` · ${plural(plan.droppedColumns.length, "עמודה ריקה אחת הושמטה", "עמודות ריקות הושמטו")}` : ""}
        </span>
        <div style={{ marginInlineStart: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {live && (
            <>
              <span style={{ fontSize: 11.5, color: C.muted, fontVariantNumeric: "tabular-nums" }}>
                {live.fetchedAt ? `נמשך ב-${live.fetchedAt.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}` : ""}
              </span>
              <button onClick={live.onRefresh} disabled={live.busy} style={{ ...btnGhost, color: C.grape, borderColor: `${C.grape}55`, cursor: live.busy ? "wait" : "pointer" }}>
                {live.busy ? "מושך…" : "↻ משיכה מחדש"}
              </button>
            </>
          )}
          <button onClick={onBack} style={btnGhost}>תיקון טיפוסים</button>
          <button onClick={onReset} style={btnGhost}>מקור אחר</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 14 }}>
        {kpis.map((k, i) => <KpiTile key={i} k={k} i={i} />)}
      </div>

      {attention.count > 0 && <AttentionBanner attention={attention} />}

      <GoalCard board={board} prefs={prefs} setPrefs={setPrefs} />

      <SliceSection board={board} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12 }}>
        {charts.map((w, i) => (
          <ChartCard
            key={w.key} w={w} i={i} pinned={w.pinned}
            onPin={() => toggleKey("pinnedWidgets", w.key)}
            onHide={() => toggleKey("hiddenWidgets", w.key)}
          />
        ))}
      </div>

      {more.length > 0 && <MoreRow more={more} onRestore={(k) => toggleKey("pinnedWidgets", k)} />}

      {save && <SaveCard plan={plan} save={save} />}

      {hasTimeline && <Records board={board} />}
    </div>
  );
}

/* ── slices, on a sheet ────────────────────────────────────────────────────
   The engine is pure over `Board`, and `planToBoard` produces exactly that
   shape — so a sheet gets the same open slicing a connected Monday board gets,
   with no engine code of its own. The only difference is where it runs: here
   the slice is computed IN THE TAB, like everything else on this screen, so a
   spreadsheet still never leaves the browser.

   No account, no wizard, no AI: the builder IS the whole interface. */
function SliceSection({ board }: { board: BI.Board }) {
  const [slices, setSlices] = useState<SliceSpec[]>([]);
  const [building, setBuilding] = useState(false);

  const cols: SliceCol[] = useMemo(
    () => board.columns.map((c) => ({ title: c.title, type: bucketOf(c.type) })).filter((c) => c.type !== "meta"),
    [board]
  );

  // A slice whose column vanished (the user corrected a type, or refetched a
  // changed sheet) is dropped from the view, not left rendering a stale answer.
  const built = useMemo(
    () => slices.map((sl) => ({ sl, w: sliceWidget([board], sl) })).filter((x) => x.w),
    [slices, board]
  );

  if (!cols.length) return null;

  return (
    <div style={{ margin: "0 0 14px" }}>
      {building ? (
        <div style={{ marginBottom: built.length ? 12 : 0 }}>
          <SliceBuilder cols={cols} onAdd={(sl) => { setSlices([...slices, sl]); setBuilding(false); }} />
          <button onClick={() => setBuilding(false)} style={{ ...btnGhost, marginTop: 8 }}>ביטול</button>
        </div>
      ) : (
        <button
          onClick={() => setBuilding(true)}
          style={{ ...card, width: "100%", padding: "11px 15px", border: `1.5px dashed ${C.grape}55`, background: "#fff", color: C.grape, fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", textAlign: "right", marginBottom: built.length ? 12 : 0 }}
        >✂️ בניית חיתוך משלכם — כל עמודה לפי כל עמודה</button>
      )}

      {built.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12 }}>
          {built.map(({ sl, w }, i) => (
            <div key={`${describeSlice(sl)}-${i}`} style={{ ...card, padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ width: 8, height: 22, borderRadius: 4, background: C.grape }} />
                <div style={{ fontSize: 14, fontWeight: 800, flex: 1 }}>{w!.title}</div>
                <button
                  onClick={() => setSlices(slices.filter((x) => x !== sl))}
                  aria-label={`הסרת ${w!.title}`}
                  style={{ border: "none", background: C.bg, borderRadius: 8, width: 26, height: 26, cursor: "pointer", color: C.muted, fontSize: 12 }}
                >✕</button>
              </div>
              <SliceBody d={w!.data as unknown as SliceData} />
              <div style={{ marginTop: 12, fontSize: 10.5, color: "#B4B2C6", borderTop: `1px dashed ${C.line}`, paddingTop: 8 }}>✂️ {describeSlice(sl)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* Who needs looking at, and the honest caveat about WHY they were picked.
   On a Monday board the choice comes from the colour the board gave a label;
   a spreadsheet carries no colours, so here it can only read the text — and
   the banner says so rather than letting the number look equally certain. */
function AttentionBanner({ attention }: { attention: { count: number; items: { name: string; why: string }[] } }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ ...card, borderColor: `${C.amber}55`, background: C.amberL, padding: "11px 15px", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15 }}>▲</span>
        <b style={{ fontSize: 13.5 }}>{attention.count} דורשים תשומת לב</b>
        <button
          onClick={() => setOpen(!open)}
          style={{ ...btnGhost, padding: "4px 11px", fontSize: 12, borderColor: `${C.amber}88`, color: "#8a5a00" }}
        >{open ? "▾ הסתרה" : "הצגת השמות"}</button>
      </div>
      {open && (
        <div style={{ marginTop: 9, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 4 }}>
          {attention.items.map((it, i) => (
            <div key={i} style={{ fontSize: 12, lineHeight: 1.6 }}>
              <b>{it.name}</b> <span style={{ color: C.muted }}>· {it.why}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.7, marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${C.amber}55` }}>
        גיליון לא נושא צבעים כמו לוח Monday, ולכן הסימון נשען על הטקסט שבתא בלבד. במערכת מחוברת הוא מגיע מהצבע שהלוח עצמו נתן לתווית.
      </div>
    </div>
  );
}

/* "מה חשוב לך" — the purpose sentence and the column marks, which reorder the
   board immediately (משוב מיטל: כל שדה קלט נשפט לפי אם הלוח הגיב מיד). On a
   connected board these are saved per organisation; here they live in the tab,
   because a sheet has no account to save them against. */
function GoalCard({ board, prefs, setPrefs }: {
  board: BI.Board; prefs: BoardPrefs; setPrefs: (f: (p: BoardPrefs) => BoardPrefs) => void;
}) {
  const [open, setOpen] = useState(false);
  const cols = useMemo(
    () => profileBoard(board).columns.filter((c) => c.bucket !== "meta" && c.score > 0),
    [board]
  );
  const marked = new Set(prefs.importantColumns ?? []);
  if (!cols.length) return null;

  return (
    <div style={{ ...card, padding: "12px 15px", marginBottom: 14 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: FONT, textAlign: "right", color: C.ink }}
      >
        <span style={{ fontSize: 15 }}>🎯</span>
        <span style={{ fontSize: 13, fontWeight: 800, flex: 1 }}>מה חשוב לכם לראות</span>
        <span style={{ fontSize: 11.5, color: C.muted }}>
          {marked.size ? `${marked.size} עמודות מסומנות` : "הלוח מסודר לפי מה שהמנוע מצא"}
        </span>
        <span style={{ color: C.muted, fontSize: 12 }}>{open ? "▾" : "◂"}</span>
      </button>

      {open && (
        <div style={{ marginTop: 11 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 5 }}>במשפט אחד — למה הגיליון הזה?</div>
          <input
            value={prefs.goalsText ?? ""}
            onChange={(e) => setPrefs((p) => ({ ...p, goalsText: e.target.value.slice(0, 500) }))}
            placeholder='למשל: "לעקוב אחרי סטטוס טיפול לפי בית ספר"'
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 11px", borderRadius: 10, border: `1.5px solid ${C.line}`, background: "#FAF9FE", fontSize: 12.5, fontFamily: FONT, color: C.ink, outline: "none" }}
          />
          <div style={{ fontSize: 11, color: C.muted, margin: "6px 0 11px", lineHeight: 1.6 }}>
            עמודה שתנקבו בשמה כאן עולה לראש הלוח מיד, גם אם המנוע חשב שהיא לא מעניינת.
          </div>

          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>או סמנו ישירות</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {cols.map((c) => {
              const on = marked.has(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => setPrefs((p) => {
                    const cur = new Set(p.importantColumns ?? []);
                    if (cur.has(c.id)) cur.delete(c.id); else cur.add(c.id);
                    return { ...p, importantColumns: [...cur] };
                  })}
                  aria-pressed={on}
                  style={{ fontSize: 12, fontWeight: on ? 700 : 500, padding: "5px 11px", borderRadius: 999, cursor: "pointer", fontFamily: FONT, border: `1.5px solid ${on ? C.grape : C.line}`, background: on ? C.grapeL : C.panel, color: on ? C.grape : C.muted }}
                >{on ? "✓ " : ""}{c.title}</button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── saving, and the sentence that has to come with it ─────────────────────
   הכרעת מיטל 4.9: store the data, so automations can run on an uploaded sheet.

   An automation does not need to write anywhere — it needs to READ when nobody
   is looking. The weekly digest fires Sunday at 05:00 with no browser open, and
   a file dragged into a tab is gone by then. So a saved dashboard has to carry
   its spreadsheet with it.

   That makes the screen's standing promise ("הקובץ לא נשלח לשרת ולא נשמר")
   false for this one action, and a false sentence in a privacy notice is worse
   than no sentence. So: LOOKING still stores nothing and needs no account, and
   this card is the only door out of that. It says what will be stored, before
   the button, in the same words the product would use if asked later. */
function SaveCard({ plan, save }: { plan: SheetPlan; save: SaveInfo }) {
  const user = useUser();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState(plan.boardName || plan.fileName);

  const isLink = save.source.kind === "link";
  const tooBig = save.csv.length > 2 * 1024 * 1024;

  async function run() {
    setBusy(true); setErr(null);
    try {
      // Two steps, deliberately: the spreadsheet is stored first and answers
      // with its own id, so a dashboard can never point at a source that was
      // not actually written.
      const srcRes = await fetch("/api/sheet-sources", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, kind: save.source.kind, csv: save.csv,
          url: isLink ? (save.source as { url: string }).url : undefined,
          typeOverrides: save.types,
        }),
      });
      const src = await srcRes.json().catch(() => ({}));
      if (!srcRes.ok) { setErr(src.error || "שמירת הגיליון נכשלה"); return; }

      const dashRes = await fetch("/api/dashboards", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetSourceId: src.id, title, purpose: "" }),
      });
      const dash = await dashRes.json().catch(() => ({}));
      if (!dashRes.ok) { setErr(dash.error || "יצירת הדשבורד נכשלה"); return; }
      setDone(dash.id as string);
    } catch { setErr("לא הצלחנו לפנות לשרת"); }
    finally { setBusy(false); }
  }

  if (done) {
    return (
      <div style={{ ...card, borderColor: `${C.teal}66`, background: C.tealL, padding: "14px 17px", marginTop: 14, fontSize: 13, lineHeight: 1.75 }}>
        ✓ נשמר. הדשבורד הזה קיים עכשיו גם כשהלשונית סגורה, והדיגסט השבועי יכלול אותו.{" "}
        <Link href={`/app?tab=dash&dashboard=${done}`} style={{ color: "#0B8F76", fontWeight: 800 }}>לפתוח אותו →</Link>
      </div>
    );
  }

  return (
    <div style={{ ...card, padding: "15px 18px", marginTop: 14 }}>
      <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 5 }}>לשמור את הדשבורד הזה?</div>
      <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.8, marginBottom: 12 }}>
        עד עכשיו הכול חושב כאן בלשונית ולא נשמר בשום מקום. <b style={{ color: C.ink }}>שמירה משנה את זה:</b>{" "}
        {isLink
          ? "הקישור ותוכן הגיליון כפי שנמשך עכשיו יישמרו אצלנו, כדי שהשרת יוכל למשוך אותו מחדש לבד."
          : "תוכן הגיליון עצמו יישמר אצלנו — אחרת אין מה לקרוא ביום ראשון בבוקר, כשהלשונית סגורה."}
        {" "}זה מה שמאפשר דיגסט שבועי והתראות. מחיקת הדשבורד מוחקת גם את הנתונים.
      </div>

      {tooBig ? (
        <div style={{ fontSize: 12.5, color: C.coral }}>הגיליון גדול מ-2MB — אפשר להסתכל עליו כאן, אבל לא לשמור אותו.</div>
      ) : !user ? (
        <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.7 }}>
          לשמירה צריך חשבון ארגוני — הנתונים נשמרים תחת ארגון, לא באוויר.{" "}
          <Link href="/app" style={{ color: C.grape, fontWeight: 700 }}>להתחברות →</Link>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={title} onChange={(e) => setTitle(e.target.value.slice(0, 80))}
            aria-label="שם הדשבורד"
            style={{ flex: "1 1 220px", padding: "9px 12px", borderRadius: 11, border: `1.5px solid ${C.line}`, background: "#FAF9FE", fontSize: 13, fontFamily: FONT, color: C.ink, outline: "none" }}
          />
          <button
            onClick={() => void run()} disabled={busy || !title.trim()}
            style={{ border: "none", background: C.grape, color: "#fff", borderRadius: 11, padding: "10px 20px", fontSize: 13, fontWeight: 800, fontFamily: FONT, cursor: busy ? "wait" : "pointer", opacity: title.trim() ? 1 : .5 }}
          >{busy ? "שומרים…" : "שמירה, כולל הנתונים"}</button>
          {err && <span style={{ fontSize: 12, color: C.coral }}>{err}</span>}
        </div>
      )}
    </div>
  );
}

/* Nothing is thrown away, only set aside: what the relevance layer dropped —
   and what the user hid — sits here, one click from coming back. */
function MoreRow({ more, onRestore }: { more: { key: string; label: string; hiddenByUser: boolean }[]; onRestore: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 14 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ ...btnGhost, fontSize: 12.5 }}
      >{open ? "▾ הסתרת עוד רכיבים" : `עוד ${plural(more.length, "רכיב אחד שהלוח יודע להציג", "רכיבים שהלוח יודע להציג")}`}</button>
      {open && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}>
          {more.map((m) => (
            <button
              key={m.key}
              onClick={() => onRestore(m.key)}
              title={m.hiddenByUser ? "הסתרתם את זה — להחזרה" : "הושמט כי לא נמצא בו אות — להצגה בכל זאת"}
              style={{ fontSize: 12, padding: "6px 12px", borderRadius: 999, cursor: "pointer", fontFamily: FONT, border: `1.5px dashed ${C.line}`, background: C.panel, color: C.muted }}
            >+ {m.label}{m.hiddenByUser ? " (הוסתר)" : ""}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function ViewOnlyBanner({ live }: { live: boolean }) {
  return (
    <div style={{ ...card, padding: "13px 17px", marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      <span style={{ fontSize: 18, lineHeight: 1.2 }}>👁️</span>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 3 }}>תצוגה בלבד</div>
        <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.7 }}>
          {live
            ? "הכול חושב כאן בדפדפן, מהגיליון שקישרתם. הנתונים עוברים דרך השרת שלנו בדרך לכאן ולא נשמרים בו. ״משיכה מחדש״ קוראת את הגיליון כפי שהוא עכשיו."
            : "הכול חושב כאן בדפדפן, מהקובץ שבחרתם. הוא לא נשלח לשרת ולא נשמר — סגירת הלשונית מוחקת אותו."}
          {" "}אין כתיבה חזרה, אין אוטומציות ואין דיוור. למערכת חיה שגם פועלת — <Link href="/app" style={{ color: C.grape, fontWeight: 700 }}>מחברים את Monday</Link>.
        </div>
      </div>
    </div>
  );
}

function Records({ board }: { board: BI.Board }) {
  const [open, setOpen] = useState<string | null>(null);
  const item = board.items.find((x) => x.id === open) || null;
  const tl = item ? BI.timeline(board, item) : null;
  const stages = (tl?.data as { stages: BI.Stage[]; passed: number; total: number } | undefined);

  return (
    <div style={{ ...card, padding: "16px 18px", marginTop: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>ציר הזמן של רשומה</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 11 }}>לקובץ הזה יש עמודות תאריך, אז לכל שורה יש סדר אירועים משלה. בחרו שורה.</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: open ? 14 : 0 }}>
        {board.items.slice(0, 60).map((it, j) => {
          const on = it.id === open;
          return (
            <button
              key={it.id} onClick={() => setOpen(on ? null : it.id)}
              style={{
                fontFamily: FONT, fontSize: 12, fontWeight: 600, cursor: "pointer",
                padding: "5px 11px", borderRadius: 999, border: `1px solid ${on ? C.grape : C.line}`,
                background: on ? C.grape : pick(j).bg, color: on ? "#fff" : pick(j).fg,
              }}
            >{it.name}</button>
          );
        })}
        {board.items.length > 60 && <span style={{ fontSize: 11.5, color: C.muted, alignSelf: "center" }}>ועוד {board.items.length - 60}</span>}
      </div>

      {stages && (
        <div style={{ borderTop: `1px dashed ${C.line}`, paddingTop: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 9 }}>{tl?.title} — {stages.passed} מתוך {stages.total} שלבים עם תאריך</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {stages.stages.map((s) => (
              <div key={s.colId} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, opacity: s.at === null ? .45 : 1 }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.at === null ? "#D5D3E4" : C.grape, flexShrink: 0 }} />
                <span style={{ fontWeight: 600 }}>{s.title}</span>
                <span style={{ marginInlineStart: "auto", color: C.muted, fontVariantNumeric: "tabular-nums" }}>{s.iso || "טרם"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── shared bits of style ───────────────────────────────────────────────── */

const btnPrimary: React.CSSProperties = {
  fontFamily: FONT, fontSize: 14, fontWeight: 700, cursor: "pointer",
  padding: "11px 22px", borderRadius: 12, border: "none", background: C.grape, color: "#fff",
};
const btnGhost: React.CSSProperties = {
  fontFamily: FONT, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
  padding: "8px 14px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.panel, color: C.ink,
};
const th: React.CSSProperties = { textAlign: "start", padding: "10px 14px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { textAlign: "start", padding: "10px 14px", verticalAlign: "middle" };
