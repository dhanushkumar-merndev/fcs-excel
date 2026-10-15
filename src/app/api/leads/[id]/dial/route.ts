import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Records a "dial requested" event when someone taps Call. Sent with navigator.sendBeacon so it
 * survives the switch to the phone app. It never creates a call log or implies the call connected.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/leads/[id]/dial">) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.nextUrl.host) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase.rpc("log_dial_action", { p_lead_id: id });
  if (error) {
    const status = error.code === "CR404" ? 404 : error.code === "CR401" ? 401 : 400;
    return NextResponse.json({ ok: false }, { status });
  }
  return NextResponse.json({ ok: true });
}
