/* הבורר — "מצאתי 5 עמודות שיכולות לענות על זה. איזו?" (מיטל, 5.9)
 *
 * המסך הזה נולד מארבעה סבבי תיקון על בקשה אחת. השורש לא היה באג: המערכת קיבלה
 * משפט חופשי, **ניחשה** לאיזו עמודה הכוונה, ולא הראתה את הניחוש — מיטל גילתה
 * אותו רק בשם הדשבורד שנוצר, כשכבר מאוחר. וזה היה מיותר לגמרי: המערכת קראה את
 * שמות העמודות של 97 לוחות בשאילתה אחת, ובחרה מתוך רשימה סופית בת חמש.
 *
 * לכן הטקסט החופשי חוזר לתפקידו הנכון — **להציע**. המועמדת המדורגת ראשונה
 * (אותה הכרעה שהמנוע היה מקבל לבד) מסומנת מראש, וההכרעה נשארת אצל המשתמשת.
 *
 * והחצי השני: הכיסוי נאמר **לפני** הבנייה. "מה עושה היום" מלאה ב-25% בלבד,
 * ובשני לוחות היא 0. בלי המספר הזה הדשבורד מציג בית ספר שלא מילא כלום כאילו אף
 * בוגר שם לא עושה דבר — במקום "לא נאסף". זה ההבדל בין מספרים לבין משהו
 * שסומכים עליו בישיבת הנהלה.
 */
import { BUCKET_LABEL, type ColumnCandidate } from "@/lib/board-profile";
import { candidateFacts, fillLine, type ColumnCoverage } from "@/lib/column-coverage";
import { C } from "./theme";

/* המשפטים עצמם — כמה לוחות, כמה שורות, כמה מזה מלא, ומה לא נמדד — נקבעים
   ב-column-coverage.ts, כדי שיהיו ניתנים לבדיקה בלי לרנדר. */

export function CandidatePicker({
  note, candidates, coverage, covLoading, picked, onPick, crossBoardMax, onBuildCross, onGoBoard,
}: {
  note: string;
  candidates: ColumnCandidate[];
  coverage: Record<string, ColumnCoverage>;
  covLoading: boolean;
  picked: number;
  onPick: (i: number) => void;
  crossBoardMax: number;
  onBuildCross: () => void;
  onGoBoard: (boardId: string, boardName: string) => void;
}) {
  const cur = candidates[picked];
  if (!cur) return null;
  const dropped = Math.max(0, cur.boards.length - crossBoardMax);
  const cov = coverage[cur.column];

  return (
    <div style={{ background: C.amberL, border: `1px solid ${C.amber}55`, borderRadius: 14, padding: "12px 14px", marginBottom: 12 }}>
      <div style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.6, marginBottom: 9 }}>💡 {note}</div>

      <div role="radiogroup" aria-label="עמודות שיכולות לענות" style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
        {candidates.map((c, i) => {
          const on = i === picked;
          const cc = coverage[c.column];
          const fill = fillLine(cc, covLoading);
          return (
            <button
              key={c.column} role="radio" aria-checked={on} onClick={() => onPick(i)}
              style={{
                display: "flex", alignItems: "flex-start", gap: 9, padding: "8px 11px", borderRadius: 11,
                border: `1.5px solid ${on ? C.grape : "#EBE6DC"}`, background: on ? "#fff" : "#FFFDF8",
                cursor: "pointer", textAlign: "right", fontFamily: "inherit", width: "100%",
              }}
            >
              <span style={{ width: 15, height: 15, borderRadius: "50%", marginTop: 2, flexShrink: 0, border: `2px solid ${on ? C.grape : "#C9C5E8"}`, background: "#fff", display: "grid", placeItems: "center" }}>
                {on && <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.grape }} />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                  <b style={{ fontSize: 13, color: C.ink, fontWeight: on ? 800 : 600 }}>״{c.column}״</b>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, background: "#F1EFF8", borderRadius: 99, padding: "1px 7px" }}>
                    {BUCKET_LABEL[c.bucket]}
                  </span>
                </span>
                <span style={{ display: "block", fontSize: 11.5, color: C.muted, marginTop: 2, lineHeight: 1.6 }}>
                  {candidateFacts(c, crossBoardMax)}{fill ? ` · ${fill}` : ""}
                </span>
                {/* בית ספר שלא מילא כלום הוא "לא נאסף" — לא "אף אחד לא עושה כלום". */}
                {cc && cc.emptyBoards.length > 0 && (
                  <span style={{ display: "block", fontSize: 11, color: "#D63A5C", marginTop: 2, lineHeight: 1.6 }}>
                    {cc.emptyBoards.length === 1 ? "לוח אחד בלי אף ערך" : `${cc.emptyBoards.length} לוחות בלי אף ערך`}: {cc.emptyBoards.slice(0, 3).join(" · ")}{cc.emptyBoards.length > 3 ? " ועוד…" : ""}
                  </span>
                )}
                {/* איות אחר נספר בנפרד: "11 לוחות" חייב להיות אחד-עשר לוחות
                    שקוראים לעמודה שלהם ככה, אחרת זה שוב מדד שמתגמל עמימות. */}
                {c.nearBoards.length > 0 && (
                  <span style={{ display: "block", fontSize: 11, color: C.muted, marginTop: 2 }}>
                    {c.nearBoards.length === 1
                      ? "עוד לוח אחד מאיית את זה אחרת — לא ייכלל"
                      : `עוד ${c.nearBoards.length} לוחות מאייתים את זה אחרת — לא ייכללו`}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* מה שלא ייכנס — נאמר לפני הלחיצה, לא מתגלה בדשבורד. */}
      {dropped > 0 && (
        <div style={{ fontSize: 11.5, color: "#D63A5C", marginBottom: 8, lineHeight: 1.6 }}>
          ⚠️ דשבורד חוצה-לוחות קורא עד {crossBoardMax} לוחות. יוצגו {crossBoardMax} מתוך {cur.boards.length}, ולא ייכללו: {cur.boards.slice(crossBoardMax).map((b) => b.boardName).join(" · ")}.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {cur.boards.length >= 2 && (
          <button
            onClick={onBuildCross}
            style={{ border: "none", background: C.grape, color: "#fff", borderRadius: 9, padding: "6px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >{`📊 להציג את ״${cur.column}״ מ-${Math.min(cur.boards.length, crossBoardMax)} הלוחות יחד ←`}</button>
        )}
        <button
          onClick={() => onGoBoard(cur.boards[0].boardId, cur.boards[0].boardName)}
          style={{ border: "none", background: C.amber, color: "#fff", borderRadius: 9, padding: "6px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
        >{`לבנות על ״${cur.boards[0].boardName}״ בלבד ←`}</button>
      </div>
      {cov && cov.missingBoards.length > 0 && (
        <div style={{ fontSize: 11, color: C.muted, marginTop: 7, lineHeight: 1.6 }}>
          לא נמדדו (אין בהם עמודה מתאימה): {cov.missingBoards.join(" · ")}
        </div>
      )}
    </div>
  );
}
