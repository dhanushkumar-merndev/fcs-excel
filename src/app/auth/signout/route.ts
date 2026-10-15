import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function signOut(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const reason = request.nextUrl.searchParams.get("reason");
  const target = new URL("/login", request.nextUrl.origin);
  if (reason && /^[a-z_]+$/.test(reason)) target.searchParams.set("reason", reason);
  return NextResponse.redirect(target, { status: 303 });
}

export const GET = signOut;
export const POST = signOut;
