// Turning a pasted Google Sheets link into a CSV endpoint — the SSRF rule, in
// one place.
//
// The URL the user pasted is NEVER fetched. It is only PARSED, for a
// spreadsheet id (and optional gid), and the fetch URL is rebuilt from a fixed
// template on a fixed host. A pasted URL can choose WHICH public sheet to
// read, and nothing else.
//
// Extracted from /api/sheets because a saved sheet source has to re-read the
// same link on a schedule (הכרעת מיטל 4.9 — אוטומציות). Two callers, one rule:
// a second copy of this parser is a second place for the rule to be wrong.

export const SHARE_HINT =
  "ודאו שהגיליון משותף: שיתוף ← גישה כללית ← \"כל מי שיש לו הקישור\" (צופה מספיק).";

/** The two shapes of a Sheets link, each mapped to its own CSV endpoint. */
export function csvUrlFor(raw: string): { url: string } | { bad: string } {
  let u: URL;
  try { u = new URL(raw); } catch { return { bad: "זה לא נראה כמו קישור. הדביקו את הכתובת המלאה מהדפדפן." }; }
  if (u.hostname !== "docs.google.com") {
    return { bad: "הקישור צריך להיות של Google Sheets (docs.google.com). פתחו את הגיליון והעתיקו את הכתובת מהדפדפן." };
  }
  // The tab id lives in the hash (#gid=), sometimes in the query.
  const gid = (u.hash.match(/gid=(\d+)/) || u.search.match(/gid=(\d+)/) || [])[1];
  const pub = u.pathname.match(/^\/spreadsheets\/d\/e\/([A-Za-z0-9_-]+)/);
  if (pub) return { url: `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?output=csv${gid ? `&gid=${gid}` : ""}` };
  const doc = u.pathname.match(/^\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/);
  if (doc) return { url: `https://docs.google.com/spreadsheets/d/${doc[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}` };
  return { bad: "לא זיהיתי בקישור מזהה של גיליון. פתחו את הגיליון והעתיקו את הכתובת מהדפדפן." };
}

/** Is this a link we would be willing to fetch? Used before STORING one. */
export const isReadableSheetLink = (raw: string): boolean => "url" in csvUrlFor(raw);
