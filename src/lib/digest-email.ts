/**
 * The weekly digest email — subject line + HTML body + a plain-text twin.
 *
 * This file RENDERS. It does not analyse: every number, name and label handed
 * to it was already computed by `board-intelligence.ts` (the one engine) and
 * passed in by `/api/digest`. There is no second calculation here, and there is
 * no list of words: a status is coloured by the `Tone` the engine derived from
 * the colour the board itself gave that label, so the same code produces a
 * correct email for a construction company and for a youth charity, in Hebrew,
 * Arabic or English, with zero per-customer lines.
 *
 * Email-client constraints (these are not stylistic preferences):
 *  - tables + inline styles only. No flexbox, no grid, no CSS variables,
 *    no <style> block, no classes — Gmail/Outlook strip or ignore them.
 *  - `dir="rtl"` on every block, plus `align="right"` on cells, because a
 *    stripped stylesheet must not flip the text to LTR.
 *  - fixed 600px shell with `max-width:100%` so it still reads on a phone.
 */

import * as BI from "./board-intelligence";
import type { Tone } from "./board-intelligence";

/* ------------------------------------------------------------------ types */

/** One headline number, straight out of `BI.headlineKpis`. */
export interface DigestKpi { icon: string; n: number; label: string; tone: string }

/** One row of `BI.breakdown` — the tone came with it. */
export interface DigestRow { label: string; n: number; tone: Tone }

/** One phrased discovery. Always carries the column/board it was read from. */
export interface DigestInsight { title: string; body: string; source: string; tone: string }

/** Everything the email says about one board. */
export interface DigestBoard {
  name: string;
  /** What this board calls a row, per `BI.terminology` — never hardcoded here. */
  entity: string;
  entityPlural: string;
  /** The real row count Monday reports (`items_count`), not what we managed to read. */
  total: number;
  /** How many rows were actually read. Equals `total` unless the board is huge. */
  loaded: number;
  truncated: boolean;
  kpis: DigestKpi[];
  attention: { count: number; rows: { name: string; why: string }[] };
  breakdown: { colTitle: string; rows: DigestRow[] } | null;
  insights: DigestInsight[];
}

export interface DigestCoverage { loaded: number; total: number; truncated: boolean; note: string }

/**
 * Per-org branding (W1). All optional: without it the email is exactly what it
 * always was. Values arrive from the org row, but they are still treated as
 * untrusted text — the name is escaped, the colour must be a hex literal and
 * the logo must be an https URL, or they are silently ignored.
 */
export interface DigestBranding {
  orgName?: string | null;
  logoUrl?: string | null;
  brandColor?: string | null;
}

export interface DigestInput {
  boards: DigestBoard[];
  coverage: DigestCoverage;
  generatedAt: Date;
  /** Where the numbers came from, for the footer. */
  sourceLabel: string;
  branding?: DigestBranding;
}

export interface RenderedDigest { subject: string; html: string; text: string }


/* --------------------------------------------------------- content builder */

/**
 * A board as `fetchBoards()` returns it. Declared structurally rather than
 * imported from `board-fetch.ts`, so this module stays free of `next/headers`
 * and can be exercised on its own against the real engine.
 */
export interface DigestSource extends BI.Board {
  itemsCount: number;
  loaded: number;
  truncated: boolean;
}

/** Column TYPES, never column names — RULES §1. Same set the dashboard uses. */
const STATUS_TYPES = ["status", "color", "dropdown"];
const ATTENTION_IN_EMAIL = 8;

/**
 * Turn one fetched board into the section the email renders.
 *
 * Every value below is an ENGINE output — `terminology`, `headlineKpis`,
 * `attention`, `breakdown`, `byOwner`, `numberSummary`. Nothing is recomputed
 * here and nothing is matched against a word: "needs attention" is exactly what
 * `attention()` says, which it derives from the colour the board itself gave
 * the label. The only thing this function decides is WHICH engine outputs are
 * worth an email, and in what order.
 */
export function digestSection(b: DigestSource): DigestBoard {
  const term = BI.terminology(b);
  // The engine works on what was actually read, so when a board was truncated
  // every derived line has to say so — same wording the insights screen uses.
  const sample = b.truncated ? ` · מדגם ${b.loaded} מתוך ${b.itemsCount}` : "";
  const denom = b.loaded || 1;
  const pct = (n: number) => Math.round((n / denom) * 100);

  const att = BI.attention(b).data as { count: number; items: { name: string; why: string }[] };

  const statusCols = b.columns.filter((c) => STATUS_TYPES.includes(c.type));
  const breakdowns = statusCols
    .map((c) => ({ col: c.title, w: BI.breakdown(b, c.title) }))
    .filter((x): x is { col: string; w: BI.Widget } => Boolean(x.w))
    .map((x) => ({ col: x.col, rows: (x.w.data as { rows: DigestRow[] }).rows || [] }));

  const kpis = BI.headlineKpis(b);
  // `headlineKpis` counts the rows it was handed, which on a truncated board is
  // the sample. Monday reports the board's real size, so the "total" KPI is
  // restored to the true number instead of a sample wearing the word "total".
  // Everything else stays exactly as the engine computed it, and the banner
  // directly above it says the rest is a sample.
  if (b.truncated && kpis.length) kpis[0] = { ...kpis[0], n: b.itemsCount };

  /* ---- 3-4 phrased discoveries, each an engine output with its source ----- */
  const insights: DigestInsight[] = [];

  if (att.count > 0) {
    const names = att.items.slice(0, 3).map((x) => x.name).join(", ");
    insights.push({
      tone: "risk",
      title: `תשומת לב נדרשת ל-${att.count} ${term.entityPlural}`,
      body: `למשל: ${names}${att.count > 3 ? " ועוד" : ""}.`,
      source: `בורד "${b.name}"${sample}`,
    });
  }

  // The dominant bucket of each status column - the "story" fact of the board.
  for (const bd of breakdowns.slice(0, 2)) {
    const top = bd.rows.find((r) => r.label !== "— ריק —");
    if (!top) continue;
    insights.push({
      tone: top.tone,
      title: `${bd.col} הנפוץ ביותר: "${top.label}"`,
      body: `${top.n} ${term.entityPlural} — ${pct(top.n)}% ממה שנקרא.`,
      source: `בורד "${b.name}" · עמודת "${bd.col}"${sample}`,
    });
  }

  const owner = BI.byOwner(b);
  const ownerRows = (owner?.data as { rows: { label: string; n: number }[] })?.rows || [];
  if (owner && ownerRows.length > 1) {
    const top = ownerRows[0];
    insights.push({
      tone: "neutral",
      title: `העומס הגדול ביותר על ${top.label}`,
      body: `${top.n} ${term.entityPlural} (${pct(top.n)}%), מתוך ${ownerRows.length} שמות בעמודה.`,
      source: `${owner.source}${sample}`,
    });
  }

  const num = BI.numberSummary(b);
  if (num) {
    const d = num.data as { sum: number; avg: number; max: number; count: number };
    insights.push({
      tone: "neutral",
      title: `${num.title}: ${d.sum}`,
      body: `ממוצע ${d.avg}, מקסימום ${d.max}. חושב על ${d.count} רשומות שיש בהן ערך.`,
      source: `${num.source}${sample}`,
    });
  }

  return {
    name: b.name,
    entity: term.entity,
    entityPlural: term.entityPlural,
    total: Math.max(b.itemsCount, b.loaded),
    loaded: b.loaded,
    truncated: b.truncated,
    kpis,
    attention: { count: att.count, rows: att.items.slice(0, ATTENTION_IN_EMAIL) },
    breakdown: breakdowns[0] ? { colTitle: breakdowns[0].col, rows: breakdowns[0].rows } : null,
    insights: insights.slice(0, 4),
  };
}

/* ----------------------------------------------------------------- pieces */


/**
 * Tone -> colour. The KEYS are the engine's semantic tones (plus the KPI tones
 * `headlineKpis` emits), never label text. Nothing here knows a single word of
 * any organisation's vocabulary.
 */
const PALETTE: Record<string, { fg: string; bg: string }> = {
  risk: { fg: "#B42318", bg: "#FEF3F2" },
  progress: { fg: "#B54708", bg: "#FFFAEB" },
  done: { fg: "#027A48", bg: "#ECFDF3" },
  neutral: { fg: "#475467", bg: "#F2F4F7" },
  brand: { fg: "#5B2BD9", bg: "#F4F0FE" },
  rose: { fg: "#B42318", bg: "#FEF3F2" },
  amber: { fg: "#B54708", bg: "#FFFAEB" },
  mint: { fg: "#027A48", bg: "#ECFDF3" },
};

const paint = (t: string) => PALETTE[t] || PALETTE.neutral;

const FONT = "'Segoe UI', Arial, Helvetica, sans-serif";
const INK = "#1D2939";
const MUTED = "#667085";
const LINE = "#E7E4F5";

/** Item names and board names arrive from Monday — they must never become markup. */
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hebrewDate(d: Date): string {
  try {
    return new Intl.DateTimeFormat("he-IL", {
      dateStyle: "long",
      timeZone: "Asia/Jerusalem",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** "מבוסס על 2000 מתוך 5,400" — the one sentence that keeps a partial read honest. */
function boardCoverageLine(b: DigestBoard): string {
  return b.truncated
    ? `נקראו ${fmt(b.loaded)} מתוך ${fmt(b.total)} — כל המספרים כאן מבוססים על החלק שנקרא בלבד`
    : `נקראו כל ${fmt(b.total)} הרשומות בבורד`;
}

const fmt = (n: number) => new Intl.NumberFormat("he-IL").format(n);

/* ---------------------------------------------------------------- subject */

/**
 * A subject line that says what happened, not what the file is.
 * The noun comes from `BI.terminology` (the board's own word for a row), so it
 * is never a word this file chose about somebody's organisation.
 * When the board was too big to read in full, the line says "(מדגם)" — a count
 * taken from part of the data must not read like a count of the whole.
 */
export function digestSubject(input: DigestInput): string {
  const boards = input.boards;
  if (!boards.length) return "AnyDay · לא נבחר בורד לדיגסט";

  const scope = boards.length === 1 ? boards[0].name : `${boards.length} בורדים`;
  const attention = boards.reduce((s, b) => s + b.attention.count, 0);
  const sample = input.coverage.truncated ? " (מדגם)" : "";

  if (attention > 0) {
    const lead = [...boards].sort((a, b) => b.attention.count - a.attention.count)[0];
    return `תשומת לב נדרשת ל-${fmt(attention)} ${lead.entityPlural} · ${scope}${sample}`;
  }

  const total = boards.reduce((s, b) => s + b.total, 0);
  const lead = boards[0];
  return `שבוע רגוע: אין סימני אזהרה ב-${fmt(total)} ${lead.entityPlural} · ${scope}${sample}`;
}

/* ------------------------------------------------------------- html parts */

function cell(inner: string, style = ""): string {
  // `word-break` guards against a Monday item name that is one long unbreakable
  // token (a URL, an id) pushing the 600px shell past a phone screen. Clients
  // that do not support it simply ignore it.
  return `<td align="right" dir="rtl" style="word-break:break-word;${style}">${inner}</td>`;
}

function sectionTitle(text: string): string {
  return `<div dir="rtl" style="font:600 15px/1.5 ${FONT};color:${INK};margin:0 0 8px;">${esc(text)}</div>`;
}

function sourceLine(text: string): string {
  return `<div dir="rtl" style="font:400 12px/1.6 ${FONT};color:${MUTED};margin:6px 0 0;">מקור: ${esc(text)}</div>`;
}

function kpiGrid(kpis: DigestKpi[]): string {
  if (!kpis.length) return "";
  const cells = kpis.map((k) => {
    const c = paint(k.tone);
    return `<td width="50%" align="right" dir="rtl" valign="top" style="padding:6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${c.bg};border-radius:10px;">
        <tr>${cell(
          `<div style="font:700 22px/1.2 ${FONT};color:${c.fg};">${esc(k.icon)} ${fmt(k.n)}</div>
           <div style="font:400 13px/1.5 ${FONT};color:${MUTED};margin-top:2px;">${esc(k.label)}</div>`,
          "padding:12px 14px;"
        )}</tr>
      </table>
    </td>`;
  });
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 2) {
    const pair = cells.slice(i, i + 2);
    if (pair.length === 1) pair.push(`<td width="50%">&nbsp;</td>`);
    rows.push(`<tr>${pair.join("")}</tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl">${rows.join("")}</table>`;
}

function attentionBlock(b: DigestBoard): string {
  if (!b.attention.count) {
    const c = paint("done");
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="background:${c.bg};border-radius:10px;margin:14px 0 0;">
      <tr>${cell(
        `<div style="font:600 14px/1.6 ${FONT};color:${c.fg};">אף ערך בבורד הזה לא צבוע בצבע שמסמן דרישה לתשומת לב.</div>`,
        "padding:12px 14px;"
      )}</tr></table>`;
  }
  const c = paint("risk");
  const rows = b.attention.rows
    .map(
      (r) => `<tr>${cell(
        `<span style="font:600 14px/1.6 ${FONT};color:${INK};">${esc(r.name)}</span>
         <span style="font:400 13px/1.6 ${FONT};color:${c.fg};">&nbsp;·&nbsp;${esc(r.why)}</span>`,
        `padding:8px 14px;border-bottom:1px solid ${LINE};`
      )}</tr>`
    )
    .join("");
  const more =
    b.attention.count > b.attention.rows.length
      ? `<tr>${cell(
          `<span style="font:400 13px/1.6 ${FONT};color:${MUTED};">ועוד ${fmt(
            b.attention.count - b.attention.rows.length
          )} — הרשימה המלאה בדשבורד.</span>`,
          "padding:8px 14px;"
        )}</tr>`
      : "";
  return `<div style="margin:16px 0 0;">
    ${sectionTitle(`דורשים תשומת לב (${fmt(b.attention.count)})`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="background:${c.bg};border-radius:10px;">
      ${rows}${more}
    </table>
    ${sourceLine(`בורד "${b.name}" · לפי צבע התווית שהוגדרה במונדיי`)}
  </div>`;
}

function breakdownBlock(b: DigestBoard): string {
  if (!b.breakdown || !b.breakdown.rows.length) return "";
  const shown = b.breakdown.rows.slice(0, 6);
  const denom = b.loaded || 1;
  const rows = shown
    .map((r) => {
      const c = paint(r.tone);
      const pct = Math.round((r.n / denom) * 100);
      return `<tr>
        ${cell(
          `<span style="display:inline-block;width:8px;height:8px;border-radius:8px;background:${c.fg};">&nbsp;</span>
           <span style="font:400 14px/1.6 ${FONT};color:${INK};">&nbsp;${esc(r.label)}</span>`,
          `padding:7px 14px;border-bottom:1px solid ${LINE};`
        )}
        <td align="left" dir="rtl" width="90" style="padding:7px 14px;border-bottom:1px solid ${LINE};font:600 14px/1.6 ${FONT};color:${c.fg};white-space:nowrap;">${fmt(r.n)} · ${pct}%</td>
      </tr>`;
    })
    .join("");
  return `<div style="margin:16px 0 0;">
    ${sectionTitle(`פילוח לפי "${b.breakdown.colTitle}"`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="border:1px solid ${LINE};border-radius:10px;">
      ${rows}
    </table>
    ${sourceLine(
      `בורד "${b.name}" · עמודת "${b.breakdown.colTitle}" · האחוזים מתוך ${fmt(b.loaded)} רשומות שנקראו`
    )}
  </div>`;
}

function insightsBlock(b: DigestBoard): string {
  if (!b.insights.length) return "";
  const rows = b.insights
    .map((i) => {
      const c = paint(i.tone);
      return `<tr>${cell(
        `<div style="font:600 14px/1.6 ${FONT};color:${c.fg};">${esc(i.title)}</div>
         <div style="font:400 13px/1.7 ${FONT};color:${INK};margin-top:2px;">${esc(i.body)}</div>
         <div style="font:400 12px/1.6 ${FONT};color:${MUTED};margin-top:3px;">מקור: ${esc(i.source)}</div>`,
        `padding:10px 14px;border-bottom:1px solid ${LINE};`
      )}</tr>`;
    })
    .join("");
  return `<div style="margin:16px 0 0;">
    ${sectionTitle("שמתי לב ש...")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="border:1px solid ${LINE};border-radius:10px;">
      ${rows}
    </table>
  </div>`;
}

function boardBlock(b: DigestBoard): string {
  const warn = paint("progress");
  const coverageBar = b.truncated
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="background:${warn.bg};border-radius:10px;margin:0 0 12px;">
        <tr>${cell(
          `<div style="font:600 13px/1.6 ${FONT};color:${warn.fg};">${esc(boardCoverageLine(b))}</div>`,
          "padding:10px 14px;"
        )}</tr></table>`
    : `<div dir="rtl" style="font:400 12px/1.6 ${FONT};color:${MUTED};margin:0 0 12px;">${esc(boardCoverageLine(b))}</div>`;

  return `<tr><td dir="rtl" align="right" style="padding:20px 24px;border-top:1px solid ${LINE};">
    <div dir="rtl" style="font:700 17px/1.4 ${FONT};color:${INK};margin:0 0 2px;">${esc(b.name)}</div>
    <div dir="rtl" style="font:400 13px/1.6 ${FONT};color:${MUTED};margin:0 0 12px;">${fmt(b.total)} ${esc(
      b.entityPlural
    )} בבורד הזה</div>
    ${coverageBar}
    ${kpiGrid(b.kpis)}
    ${attentionBlock(b)}
    ${insightsBlock(b)}
    ${breakdownBlock(b)}
  </td></tr>`;
}

/* ------------------------------------------------------------------ email */

/** The brand colour is used inside a style attribute — a hex literal or nothing. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
/** The logo becomes an img src — an https URL or nothing. */
const HTTPS_URL = /^https:\/\/\S+$/;

export function renderDigest(input: DigestInput): RenderedDigest {
  const subject = digestSubject(input);
  const date = hebrewDate(input.generatedAt);
  const warn = paint("progress");

  const branding = input.branding ?? {};
  const headerBg = HEX_COLOR.test(branding.brandColor ?? "") ? branding.brandColor! : "#5B2BD9";
  const orgName = (branding.orgName ?? "").trim();
  const logoUrl = HTTPS_URL.test(branding.logoUrl ?? "") ? branding.logoUrl! : null;
  const headerTitle = orgName || "AnyDay";
  const logoTag = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(headerTitle)}" height="36" style="height:36px;max-width:180px;border:0;display:block;margin:0 0 8px;">`
    : "";

  const globalCoverage = input.coverage.truncated
    ? `<tr><td dir="rtl" align="right" style="padding:14px 24px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="background:${warn.bg};border-radius:10px;">
          <tr>${cell(
            `<div style="font:600 14px/1.6 ${FONT};color:${warn.fg};">${esc(input.coverage.note)}</div>
             <div style="font:400 13px/1.6 ${FONT};color:${warn.fg};margin-top:3px;">הבורד גדול מהתקרה שהוגדרה, ולכן המספרים כאן הם מדגם ולא הסך הכול.</div>`,
            "padding:12px 14px;"
          )}</tr>
        </table>
      </td></tr>`
    : "";

  const body = input.boards.length
    ? input.boards.map(boardBlock).join("")
    : `<tr><td dir="rtl" align="right" style="padding:20px 24px;font:400 14px/1.7 ${FONT};color:${MUTED};">לא נבחר בורד, ולכן אין מה לסכם השבוע.</td></tr>`;

  const html = `<div dir="rtl" lang="he" style="background:#F6F5FB;margin:0;padding:0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="background:#F6F5FB;padding:24px 10px;">
 <tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid ${LINE};border-radius:14px;">
   <tr><td dir="rtl" align="right" style="padding:20px 24px;background:${headerBg};border-radius:14px 14px 0 0;">
     ${logoTag}
     <div style="font:700 18px/1.3 ${FONT};color:#FFFFFF;">${esc(headerTitle)}</div>
     <div style="font:400 14px/1.6 ${FONT};color:#DCD2FA;margin-top:4px;">${esc(subject)}</div>
     <div style="font:400 12px/1.6 ${FONT};color:#C4B5F7;margin-top:2px;">${esc(date)}${orgName ? ` · AnyDay` : ""}</div>
   </td></tr>
   ${globalCoverage}
   ${body}
   <tr><td dir="rtl" align="right" style="padding:16px 24px 20px;border-top:1px solid ${LINE};">
     <div style="font:400 12px/1.7 ${FONT};color:${MUTED};">
       הנתונים נקראו ישירות מ-Monday ${esc(input.sourceLabel)} ב-${esc(date)}.<br>
       כל מספר במייל חושב מהבורד עצמו — אין כאן הערכות ואין השלמות.
     </div>
   </td></tr>
  </table>
 </td></tr>
</table>
</div>`;

  return { subject, html, text: renderText(input, subject, date) };
}

/**
 * The same content as plain text. Resend is sent the HTML; this exists so the
 * wording can be read and approved without opening a mail client, and so a
 * preview call returns something a human can scan in a terminal.
 */
function renderText(input: DigestInput, subject: string, date: string): string {
  const L: string[] = [];
  L.push(subject, date, "");
  if (input.coverage.truncated) {
    L.push(`[!] ${input.coverage.note} — המספרים למטה הם מדגם, לא הסך הכול.`, "");
  }
  for (const b of input.boards) {
    L.push(`== ${b.name} ==`);
    L.push(`${fmt(b.total)} ${b.entityPlural} בבורד. ${boardCoverageLine(b)}.`);
    for (const k of b.kpis) L.push(`  ${k.icon} ${fmt(k.n)} — ${k.label}`);
    L.push("");
    if (b.attention.count) {
      L.push(`דורשים תשומת לב (${fmt(b.attention.count)}):`);
      for (const r of b.attention.rows) L.push(`  · ${r.name} — ${r.why}`);
      if (b.attention.count > b.attention.rows.length)
        L.push(`  · ועוד ${fmt(b.attention.count - b.attention.rows.length)}`);
      L.push(`  מקור: בורד "${b.name}" · לפי צבע התווית שהוגדרה במונדיי`);
    } else {
      L.push("אף ערך בבורד הזה לא צבוע בצבע שמסמן דרישה לתשומת לב.");
    }
    L.push("");
    if (b.insights.length) {
      L.push("שמתי לב ש...");
      for (const i of b.insights) L.push(`  · ${i.title} — ${i.body} [מקור: ${i.source}]`);
      L.push("");
    }
    if (b.breakdown?.rows.length) {
      L.push(`פילוח לפי "${b.breakdown.colTitle}":`);
      const denom = b.loaded || 1;
      for (const r of b.breakdown.rows.slice(0, 6))
        L.push(`  · ${r.label}: ${fmt(r.n)} (${Math.round((r.n / denom) * 100)}%)`);
      L.push(`  מקור: בורד "${b.name}" · עמודת "${b.breakdown.colTitle}" · מתוך ${fmt(b.loaded)} רשומות שנקראו`);
      L.push("");
    }
  }
  L.push(`הנתונים נקראו ישירות מ-Monday ${input.sourceLabel} ב-${date}.`);
  return L.join("\n");
}
