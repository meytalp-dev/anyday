/**
 * The shell both legal documents sit in.
 *
 * They are the least glamorous pages in the product and the ones a buyer's
 * lawyer reads first, so they get real typography rather than a wall of grey:
 * a measure that stops around 70 characters, headings that let someone scan
 * for the clause they came for, and a stated "last updated" — a policy with no
 * date cannot be trusted to describe the software that is running today.
 */

import Link from "next/link";
import type { ReactNode } from "react";

/** Where a data-subject request or a legal notice actually lands. */
export const LEGAL_CONTACT = "hello@anyday.co.il";

const INK = "#1B1830";
const MUTED = "#7C7A93";
const GRAPE = "#6C4CF1";
const LINE = "#ECEBF5";

export function LegalPage({ title, updated, intro, children }: {
  title: string;
  /** ISO date; rendered in Hebrew. Bump it whenever the text changes. */
  updated: string;
  intro: string;
  children: ReactNode;
}) {
  const date = new Date(updated).toLocaleDateString("he-IL", {
    year: "numeric", month: "long", day: "numeric",
  });

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: "#F4F3FB", color: INK, fontFamily: "Rubik, Assistant, Heebo, system-ui, sans-serif" }}>
      <header style={{ background: "#FFFFFF", borderBottom: `1px solid ${LINE}`, padding: "0 20px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", height: 58, display: "flex", alignItems: "center", gap: 10 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", color: INK }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: `linear-gradient(135deg,${GRAPE},#FF2D87)`, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 16 }}>A</div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>Any<span style={{ color: GRAPE }}>Day</span></div>
          </Link>
        </div>
      </header>

      <main style={{ maxWidth: 760, margin: "0 auto", padding: "38px 20px 80px" }}>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: "0 0 8px", lineHeight: 1.3 }}>{title}</h1>
        <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 22px" }}>עודכן לאחרונה: {date}</p>
        <p style={{ fontSize: 15.5, lineHeight: 1.85, margin: "0 0 30px", color: "#3C3959" }}>{intro}</p>
        <div style={{ fontSize: 14.5, lineHeight: 1.9 }}>{children}</div>

        <div style={{ marginTop: 44, paddingTop: 20, borderTop: `1px solid ${LINE}`, fontSize: 13, color: MUTED, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Link href="/terms" style={{ color: GRAPE }}>תנאי שימוש</Link>
          <Link href="/privacy" style={{ color: GRAPE }}>מדיניות פרטיות</Link>
          <a href={`mailto:${LEGAL_CONTACT}`} style={{ color: GRAPE }}>{LEGAL_CONTACT}</a>
        </div>
      </main>
    </div>
  );
}

/** A numbered section. The number is what a lawyer quotes back at you. */
export function Clause({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section style={{ margin: "0 0 26px" }}>
      <h2 style={{ fontSize: 17.5, fontWeight: 800, margin: "0 0 8px", lineHeight: 1.4 }}>
        <span style={{ color: GRAPE, marginInlineEnd: 8 }}>{n}.</span>{title}
      </h2>
      <div style={{ color: "#3C3959" }}>{children}</div>
    </section>
  );
}

/** A plain bulleted list, styled once so the documents stay consistent. */
export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul style={{ margin: "8px 0 0", paddingInlineStart: 20 }}>
      {items.map((it, i) => <li key={i} style={{ margin: "0 0 6px" }}>{it}</li>)}
    </ul>
  );
}
