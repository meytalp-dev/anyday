/* The "לוח חי" palette — colourful and energetic, NOT flat purple.
 *
 * Extracted from page.tsx so the slice builder and the slice table can paint
 * in the same language without page.tsx growing another few hundred lines.
 * Nothing here decides anything; it is only colour.
 */

export const C = {
  bg: "#F4F3FB", panel: "#FFFFFF", ink: "#1B1830", muted: "#7C7A93",
  grape: "#6C4CF1", grapeL: "#EEEBFE",
  coral: "#FF6B8A", coralL: "#FFEBF0",
  teal: "#12C7A8", tealL: "#DFF7F2",
  amber: "#FFAE34", amberL: "#FFF1DC",
  sky: "#3E9BFF", skyL: "#E4F1FF",
  lime: "#84D65A", limeL: "#ECF9E1",
};

export const PALETTE = [
  { fg: C.grape, bg: C.grapeL }, { fg: C.coral, bg: C.coralL }, { fg: C.teal, bg: C.tealL },
  { fg: C.amber, bg: C.amberL }, { fg: C.sky, bg: C.skyL }, { fg: C.lime, bg: C.limeL },
];

export const pick = (i: number) => PALETTE[i % PALETTE.length];

/* A status value is painted by its TONE, which arrives from the server. The
   server derives that tone from the colour the Monday board itself gave the
   label (see board-intelligence), so this screen recognises no word at all —
   a board in Hebrew, Arabic or English colours identically. */
export type Tone = "risk" | "progress" | "done" | "neutral";
export type ToneMap = Record<string, string>;

export const TONE_STYLE: Record<Tone, { fg: string; bg: string }> = {
  done: { fg: "#0B8F76", bg: C.tealL },
  risk: { fg: "#D63A5C", bg: C.coralL },
  progress: { fg: "#C77A00", bg: C.amberL },
  neutral: { fg: C.muted, bg: "#F0EFF6" },
};

export const toneStyle = (t?: string) => TONE_STYLE[t as Tone] || TONE_STYLE.neutral;
