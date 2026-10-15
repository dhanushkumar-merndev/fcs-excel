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

export async function updateSettings(input: z.input<typeof schema>): Promise<ActionResult<null>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Check the settings.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_business_settings", { p_patch: parsed.data });
  if (error) return fromDbError(error);
  refresh();
  return ok(null);
}
