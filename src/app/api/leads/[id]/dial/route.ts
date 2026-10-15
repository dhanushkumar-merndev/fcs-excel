import { NextResponse, type NextRequest } from "next/server";
import { dbErrorResponse, jsonError, requireApiStaff } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

/**
 * Records a "dial requested" event when someone taps Call. Sent with navigator.sendBeacon so it
 * survives the switch to the phone app. It never creates a call log or implies the call connected.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/leads/[id]/dial">) {
  const staff = await requireApiStaff(request);
  if (staff instanceof NextResponse) return staff;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError("Lead not found.", 404);
  const supabase = await createClient();
  const { error } = await supabase.rpc("log_dial_action", { p_lead_id: id });
  if (error) return dbErrorResponse(error);
  return NextResponse.json({ ok: true });
}
