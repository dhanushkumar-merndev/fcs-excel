"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { fromDbError, invalid, ok, type ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";

const reasons = z
  .array(z.string().trim().min(1).max(80))
  .min(1, "Keep at least one reason.")
  .max(30);

const schema = z.object({
  business_name: z.string().trim().min(1, "Enter a business name.").max(80),
  reminder_lead_minutes: z.coerce.number().int().min(0, "Use 0 or more minutes.").max(1440, "Use at most 1,440 minutes."),
  salesperson_export_enabled: z.boolean(),
  lost_reasons: reasons,
  unqualified_reasons: reasons,
});

/** Round robin on or off, and which salespeople are left out of it (admin). */
export async function updateRoundRobin(input: { enabled: boolean; excluded: string[] }): Promise<ActionResult<{ enabled: boolean; next: string | null }>> {
  const parsed = z.object({ enabled: z.boolean(), excluded: z.array(z.string().uuid()).max(200) }).safeParse(input);
  if (!parsed.success) return invalid("Check the round robin settings.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_round_robin", { p_enabled: parsed.data.enabled, p_excluded: parsed.data.excluded });
  if (error) return fromDbError(error);
  refresh();
  return ok(data as { enabled: boolean; next: string | null });
}

export async function updateSettings(input: z.input<typeof schema>): Promise<ActionResult<null>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Check the settings.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_business_settings", { p_patch: parsed.data });
  if (error) return fromDbError(error);
  refresh();
  return ok(null);
}
