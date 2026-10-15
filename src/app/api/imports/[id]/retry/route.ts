import { NextResponse, type NextRequest } from "next/server";
import { dbErrorResponse, jsonError, requireApiStaff } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

/** Puts failed rows back in the queue (they are processed idempotently). */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/imports/[id]/retry">) {
  const staff = await requireApiStaff(request, ["admin", "manager"]);
  if (staff instanceof NextResponse) return staff;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError("Import not found.", 404);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_retry_failed", { p_batch_id: id });
  if (error) return dbErrorResponse(error);
  return NextResponse.json({ ok: true, ...(data as object) });
}
