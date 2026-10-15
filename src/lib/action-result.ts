export type ActionErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "pending_follow_ups"
  | "network"
  | "unknown";

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; code: ActionErrorCode; message: string; fieldErrors?: Record<string, string> };

type PgError = { code?: string; message?: string; hint?: string | null; details?: string | null } | null;

const FRIENDLY: Record<string, ActionErrorCode> = {
  CR401: "unauthenticated",
  CR403: "forbidden",
  CR404: "not_found",
  CR409: "conflict",
  CR422: "validation",
  "42501": "forbidden",
  PGRST301: "unauthenticated",
  PGRST303: "unauthenticated",
};

/** Maps a PostgREST / Postgres error to a user-facing result. Never leaks SQL details. */
export function fromDbError<T = never>(error: PgError): ActionResult<T> {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (/jwt expired|invalid jwt|not authenticated/i.test(message)) {
    return { ok: false, code: "unauthenticated", message: "Your session expired. Sign in again to continue." };
  }
  const mapped = FRIENDLY[code];
  if (mapped === "validation" && error?.hint === "pending_follow_ups") {
    return { ok: false, code: "pending_follow_ups", message };
  }
  if (mapped && code.startsWith("CR")) return { ok: false, code: mapped, message };
  if (mapped === "forbidden") return { ok: false, code: "forbidden", message: "You don't have permission to do that." };
  if (mapped === "unauthenticated") {
    return { ok: false, code: "unauthenticated", message: "Your session expired. Sign in again to continue." };
  }
  if (code === "23514" || code === "22P02" || code === "22007" || code === "22008") {
    return { ok: false, code: "validation", message: "Some values are not valid. Check the form and try again." };
  }
  if (/fetch failed|network|ECONN|timeout/i.test(message)) {
    return { ok: false, code: "network", message: "Connection problem. Your changes were not saved — try again." };
  }
  console.error("Unexpected database error", { code, message });
  return { ok: false, code: "unknown", message: "Something went wrong. Your changes were not saved — try again." };
}

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });

export function invalid(message: string, fieldErrors?: Record<string, string>): ActionResult<never> {
  return { ok: false, code: "validation", message, fieldErrors };
}
