import { NextResponse, type NextRequest } from "next/server";
import { dbErrorResponse, jsonError, requireApiStaff } from "@/lib/api";
import { runSheetSync } from "@/lib/sheet-sync/run";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/** Leaves time to record the result before the platform stops the function. */
const BUDGET_MS = 45_000;

const SKIPPED: Record<string, { status: number; message: string }> = {
  unauthorized: { status: 401, message: "Unauthorized." },
  disabled: { status: 409, message: "Google Sheet sync is turned off." },
  not_configured: { status: 409, message: "Google Sheet sync isn't set up yet. Add the sheet under Imports → Google Sheet sync." },
  busy: { status: 202, message: "A sync is already running." },
  not_due: { status: 202, message: "Not due yet." },
};

/**
 * Runs one Google Sheet sync. Called by pg_cron at the chosen interval with a Bearer secret (checked
 * in the database against its stored hash), or by an admin or manager pressing "Sync now".
 */
export async function POST(request: NextRequest) {
  const started = Date.now();
  const authorization = request.headers.get("authorization");
  let secret: string | null = null;
  if (authorization) {
    secret = authorization.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
    if (!secret) return jsonError("Unauthorized.", 401);
  } else {
    const staff = await requireApiStaff(request, ["admin", "manager"]);
    if (staff instanceof NextResponse) return staff;
  }

  let result;
  try {
    result = await runSheetSync(createAdminClient(), { secret, manual: secret === null, deadline: started + BUDGET_MS });
  } catch (error) {
    return dbErrorResponse(error as { code?: string; message?: string });
  }

  if (result.status === "skipped") {
    const { status, message } = SKIPPED[result.reason];
    return jsonError(message, status, { code: result.reason });
  }
  if (result.status === "error") return jsonError(result.message, 502, { code: "sync_failed" });
  return NextResponse.json({ ok: true, ...result });
}
