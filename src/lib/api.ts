import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getStaffOrNull } from "@/lib/auth/dal";
import type { Role, Staff } from "@/lib/domain/types";

export function jsonError(message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, message, ...extra }, { status });
}

/** Rejects cross-site POSTs (defense in depth on top of SameSite cookies). */
export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (request.headers.get("x-forwarded-host") ?? request.nextUrl.host);
  } catch {
    return false;
  }
}

export async function requireApiStaff(request: NextRequest, roles?: Role[]): Promise<Staff | NextResponse> {
  if (request.method !== "GET" && !sameOrigin(request)) return jsonError("Cross-site request blocked.", 403);
  const staff = await getStaffOrNull();
  if (!staff) return jsonError("Your session expired. Sign in again.", 401, { code: "unauthenticated" });
  if (roles && !roles.includes(staff.role)) return jsonError("You don't have permission to do this.", 403, { code: "forbidden" });
  return staff;
}

export function dbErrorResponse(error: { code?: string; message?: string; hint?: string | null }) {
  const status =
    error.code === "CR401" ? 401 : error.code === "CR403" || error.code === "42501" ? 403 : error.code === "CR404" ? 404 : error.code === "CR409" ? 409 : error.code === "CR422" ? 422 : 500;
  const message = error.code?.startsWith("CR") ? error.message : "Something went wrong on the server. Nothing was lost — try again.";
  if (status === 500) console.error("API database error", error);
  return jsonError(message ?? "Error", status, { code: error.code });
}
