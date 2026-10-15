import { NextResponse, type NextRequest } from "next/server";
import { dbErrorResponse, jsonError, requireApiStaff } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

/** Processes the next chunk of pending rows. Safe to call repeatedly or concurrently. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/imports/[id]/process">) {
  const staff = await requireApiStaff(request, ["admin", "manager"]);
  if (staff instanceof NextResponse) return staff;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError("Import not found.", 404);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_process_rows", { p_batch_id: id, p_limit: 100 });
  if (error) return dbErrorResponse(error);
  return NextResponse.json({ ok: true, ...(data as object) });
}
