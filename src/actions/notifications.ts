"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { fromDbError, ok, type ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";

export async function markNotificationsRead(ids: string[] | null): Promise<ActionResult<{ updated: number }>> {
  const parsed = z.array(z.string().uuid()).max(500).nullable().safeParse(ids);
  if (!parsed.success) return { ok: false, code: "validation", message: "Invalid notification." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_notifications_read", { p_ids: parsed.data });
  if (error) return fromDbError(error);
  refresh();
  return ok(data as { updated: number });
}
