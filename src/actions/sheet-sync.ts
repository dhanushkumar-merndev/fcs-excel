"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { fromDbError, invalid, ok, type ActionResult } from "@/lib/action-result";
import { SYNC_INTERVALS, type SheetSyncSettings } from "@/lib/domain/sheet-sync";
import { parseSheetUrl } from "@/lib/sheet-sync/fetch";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  link: z.string().trim().min(1, "Paste the Google Sheets link.").max(2000),
  allTabs: z.boolean(),
  tabs: z
    .array(z.object({ gid: z.string().regex(/^\d{1,12}$/), name: z.string().trim().min(1).max(200), enabled: z.boolean() }))
    .min(1, "Load the sheet's tabs first.")
    .max(200),
  intervalMinutes: z.number().int().refine((n) => (SYNC_INTERVALS as readonly number[]).includes(n), "Choose how often to sync."),
  enabled: z.boolean(),
});

/** Saves the Google Sheet sync: which sheet and tabs, how often, on or paused. The saver becomes the sync actor. */
export async function saveSheetSync(input: z.input<typeof schema>): Promise<ActionResult<SheetSyncSettings>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Check the sync settings.");
  const sheet = parseSheetUrl(parsed.data.link);
  if (!sheet) return invalid("That isn't a Google Sheets link.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sheet_sync_configure", {
    p_sheet_id: sheet.sheetId,
    p_all_tabs: parsed.data.allTabs,
    p_tabs: parsed.data.tabs,
    p_interval_minutes: parsed.data.intervalMinutes,
    p_enabled: parsed.data.enabled,
  });
  if (error) return fromDbError(error);
  refresh();
  return ok(data as SheetSyncSettings);
}
