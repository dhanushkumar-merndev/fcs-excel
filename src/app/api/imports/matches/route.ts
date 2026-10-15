import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { dbErrorResponse, jsonError, requireApiStaff } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

const body = z.object({
  phones: z.array(z.string().max(20)).max(1000),
  externalIds: z.array(z.string().max(200)).max(1000),
  rawIds: z.array(z.string().max(200)).max(1000).default([]),
});

/** Existing leads matching incoming phones / source IDs, for the duplicate review step. */
export async function POST(request: NextRequest) {
  const staff = await requireApiStaff(request, ["admin", "manager"]);
  if (staff instanceof NextResponse) return staff;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request.", 400);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_find_matches", {
    p_phones: parsed.data.phones,
    p_external_ids: parsed.data.externalIds,
    p_raw_ids: parsed.data.rawIds,
  });
  if (error) return dbErrorResponse(error);
  return NextResponse.json({ ok: true, matches: data ?? [] });
}
