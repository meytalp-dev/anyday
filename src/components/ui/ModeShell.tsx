"use client";

/**
 * ModeShell — the one roof over AnyDay's two halves.
 *
 * "ניהול" (manage) is what the system tells you without being asked; "פעולות"
 * (act) is what you ask it to do. Each mode owns its own row of tabs and its
 * own accent colour, so the mode you are in is readable at a glance.
 *
 * This component is chrome only: it holds no data and knows nothing about
 * Monday. The page above it owns the state and renders the panels as children.
 * Names come from the approved mockup (anyday-ops/pages/מוקאפ-שני-המצבים.html)
 * and are locked — do not reword them.
 */

export type Mode = "manage" | "act";

/** Accent per mode: purple for manage, pink for act. */
export const MODE_COLOR: Record<Mode, string> = { manage: "#6C4CF1", act: "#FF2D87" };

export interface ShellTab {
  /** URL-safe id, becomes ?tab=<id>. */
  id: string;
  label: string;
}

const MODE_LABEL: Record<Mode, string> = { manage: "ניהול", act: "פעולות" };
const LINE = "#ECEBF5";
const MUTED = "#7C7A93";

/** Per-org branding for the roof (W1). Absent = the generic AnyDay brand block. */
export interface ShellBranding {
  orgName?: string | null;
  logoUrl?: string | null;
}

export function ModeShell({
  mode, onModeChange, tabs, tab, onTabChange, aside, branding, children,
}: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  /** Tabs of the ACTIVE mode, in display order. */
  tabs: ShellTab[];
  tab: string;
  onTabChange: (id: string) => void;
  /** Optional right-hand slot in the top bar (sync state, user name…). */
  aside?: React.ReactNode;
  /** The org's own logo + name; the page fetches it, this only paints it. */
  branding?: ShellBranding;
  children?: React.ReactNode;
}) {
  const accent = MODE_COLOR[mode];
  const orgName = branding?.orgName?.trim() || null;
  const logoUrl = branding?.logoUrl || null;

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: "#F4F3FB", fontFamily: "Rubik, Assistant, Heebo, system-ui, sans-serif", color: "#1B1830" }}>
      {/* ── top bar: brand + mode switch ── */}
      {/* overflowX: הכותרת לא רשאית לעולם לגרור גלילה אופקית של העמוד כולו —
          במסך צר היא נגללת בתוך עצמה, כמו שורת הלשוניות שמתחתיה. */}
      <header style={{ height: 58, background: "#FFFFFF", borderBottom: `1px solid ${LINE}`, display: "flex", alignItems: "center", gap: 16, padding: "0 22px", position: "sticky", top: 0, zIndex: 20, overflowX: "auto" }}>
        {/* With a logo, the roof belongs to the ORGANIZATION: its mark and its
            name lead, and AnyDay steps back to a small suffix. Without one,
            the generic brand block is exactly what it always was. */}
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- the logo is a runtime user upload from Supabase storage, not a build-time asset
            <img src={logoUrl} alt={orgName || "לוגו הארגון"} style={{ height: 32, maxWidth: 120, objectFit: "contain", borderRadius: 8 }} />
          ) : (
            <div style={{ width: 32, height: 32, borderRadius: 10, background: `linear-gradient(135deg,${MODE_COLOR.manage},${MODE_COLOR.act})`, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 16 }}>A</div>
          )}
          {orgName ? (
            <div style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 17, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 190 }}>{orgName}</div>
              <div style={{ fontWeight: 700, fontSize: 11.5, color: MUTED, whiteSpace: "nowrap" }}>Any<span style={{ color: accent }}>Day</span></div>
            </div>
          ) : (
            <div style={{ fontWeight: 800, fontSize: 18 }}>Any<span style={{ color: accent }}>Day</span></div>
          )}
        </div>

        <div role="tablist" aria-label="מצב" style={{ display: "flex", gap: 4, background: "#F1EFF9", borderRadius: 11, padding: 3, marginInlineStart: 14 }}>
          {(["manage", "act"] as Mode[]).map((m) => {
            const on = m === mode;
            return (
              <button
                key={m} role="tab" aria-selected={on} onClick={() => onModeChange(m)}
                style={{
                  border: "none", background: on ? "#FFFFFF" : "none", fontFamily: "inherit", fontSize: 13, fontWeight: 700,
                  padding: "7px 16px", borderRadius: 9, cursor: "pointer",
                  color: on ? MODE_COLOR[m] : MUTED,
                  boxShadow: on ? "0 1px 3px rgba(0,0,0,.09)" : "none",
                }}
              >
                {MODE_LABEL[m]}
              </button>
            );
          })}
        </div>

        {aside && <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 12 }}>{aside}</div>}
      </header>

      {/* ── tab row of the active mode ── */}
      <nav role="tablist" aria-label="לשוניות" style={{ display: "flex", gap: 2, padding: "0 22px", background: "#FFFFFF", borderBottom: `1px solid ${LINE}`, overflowX: "auto", position: "sticky", top: 58, zIndex: 19 }}>
        {tabs.map((t) => {
          const on = t.id === tab;
          return (
            <button
              key={t.id} role="tab" aria-selected={on} onClick={() => onTabChange(t.id)}
              style={{
                position: "relative", border: "none", background: "none", fontFamily: "inherit", cursor: "pointer",
                padding: "14px 14px", fontSize: 14, whiteSpace: "nowrap",
                fontWeight: on ? 800 : 500, color: on ? accent : MUTED,
              }}
            >
              {t.label}
              {on && <span style={{ position: "absolute", bottom: 0, insetInline: 6, height: 3, borderRadius: "3px 3px 0 0", background: accent }} />}
            </button>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
