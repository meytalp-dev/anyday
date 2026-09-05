/**
 * מי מורשה לעשות מה — במקום אחד.
 *
 * The three roles already existed in `org_users` and were already enforced —
 * but only on the harmless routes. Saving a dashboard checked the role;
 * `/api/record`, which can `delete_item` on the organisation's REAL Monday
 * board, checked nothing but the presence of a connection. So a "viewer"
 * could not hide a chart and could delete a record.
 *
 * The cause was that every route decided for itself, so three of them simply
 * forgot. One ordered scale, one comparison, one place to read.
 */

/** Ordered from least to most: every role may do what the ones below it may. */
export const ROLES = ["viewer", "member", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** What each role is allowed to do, in the words the screens use. */
export const ROLE_LABEL: Record<Role, string> = {
  viewer: "צופה",
  member: "חבר",
  admin: "מנהל",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  viewer: "רואה את הלוחות והדשבורדים. לא משנה כלום.",
  member: "גם מעדכן סטטוסים, עורך רשומות ושומר דשבורדים.",
  admin: "גם מחבר ומנתק את Monday, מזמין אנשים ומשנה הגדרות.",
};

/**
 * Where an unknown string sits on the scale: nowhere.
 *
 * A row whose role was mistyped, or written by a future version that knows a
 * role this one does not, must not be read as permission. `atLeast` therefore
 * answers false for it against every requirement — the fail-closed direction.
 */
function rank(role: string): number {
  const i = (ROLES as readonly string[]).indexOf(role);
  return i; // -1 for anything unrecognised
}

/** Is `role` at least `required`? Unknown roles are never enough. */
export function atLeast(role: string | null | undefined, required: Role): boolean {
  if (!role) return false;
  const have = rank(role);
  if (have < 0) return false;
  return have >= rank(required);
}

/** True for a role this codebase knows about. Used when accepting input. */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && rank(value) >= 0;
}

/** The refusal, said the same way everywhere. */
export function forbiddenMessage(required: Role): string {
  if (required === "admin") return "רק מנהל הארגון יכול לבצע את הפעולה הזו.";
  return "לחשבון שלכם יש הרשאת צפייה בלבד. פנו למנהל הארגון כדי לקבל הרשאת עריכה.";
}
