"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { fromDbError, invalid, ok, type ActionResult } from "@/lib/action-result";
import { CALL_OUTCOMES } from "@/lib/domain/labels";
import { STAGES } from "@/lib/domain/stages";
import { normalizePhone } from "@/lib/import/phone";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const stage = z.enum(STAGES.map((s) => s.value) as [string, ...string[]]);
const outcome = z.enum(CALL_OUTCOMES.map((o) => o.value) as [string, ...string[]]);
const isoInstant = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date and time.");
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const money = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v < 1e10), "Enter a valid amount.");

async function call<T>(fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return fromDbError(error);
  refresh();
  return ok(data as T);
}

function firstIssue(error: z.ZodError) {
  const issue = error.issues[0];
  return invalid(issue?.message ?? "Check the form and try again.", issue ? { [String(issue.path[0] ?? "form")]: issue.message } : undefined);
}

// ---------------------------------------------------------------------------

const createSchema = z.object({
  requestId: uuid,
  customerName: z.string().trim().min(1, "Enter the customer's name.").max(200),
  phone: z.string().trim().min(1, "Enter a phone number."),
  occasion: optionalText(80),
  menu: optionalText(80),
  guestRange: optionalText(40),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("")),
  eventAddress: optionalText(500),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  ownerId: uuid.optional().nullable().or(z.literal("")),
  channel: optionalText(40),
  quotedAmount: money,
  note: optionalText(5000),
});

export async function createLead(input: z.input<typeof createSchema>): Promise<ActionResult<{ id: string; lead_number: number }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const v = parsed.data;
  const phone = normalizePhone(v.phone);
  if (phone.status !== "valid") {
    return invalid(phone.status === "missing" ? "Enter a phone number." : phone.message, { phone: phone.status === "missing" ? "Required" : phone.message });
  }
  const code = (s: string | null | undefined) => (s ? s.trim().toLowerCase().replace(/\s+/g, "_") : null);
  return call("create_lead", {
    p_request_id: v.requestId,
    p_lead: {
      customer_name: v.customerName,
      phone_e164: phone.e164,
      phone_raw: phone.raw,
      occasion_code: code(v.occasion),
      menu_code: code(v.menu),
      guest_range: v.guestRange || null,
      event_date: v.eventDate || null,
      event_address: v.eventAddress || null,
      priority: v.priority,
      owner_id: v.ownerId || null,
      platform: v.channel || null,
      quoted_amount_inr: v.quotedAmount,
      note: v.note || null,
    },
  });
}

/** Phone lookup for the manual-entry duplicate warning (RLS-scoped). */
export async function findLeadsByPhone(rawPhone: string): Promise<ActionResult<{ e164: string | null; matches: { id: string; lead_number: number; customer_name: string; event_date: string | null; stage: string; owner_name: string | null }[] }>> {
  const phone = normalizePhone(String(rawPhone ?? "").slice(0, 40));
  if (phone.status !== "valid") return ok({ e164: null, matches: [] });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select("id, lead_number, customer_name, event_date, stage, owner:profiles!leads_owner_id_fkey(full_name)")
    .eq("phone_e164", phone.e164)
    .order("acquired_at", { ascending: false })
    .limit(10);
  if (error) return fromDbError(error);
  return ok({
    e164: phone.e164,
    matches: (data ?? []).map((l) => ({
      id: l.id,
      lead_number: l.lead_number,
      customer_name: l.customer_name,
      event_date: l.event_date,
      stage: l.stage,
      owner_name: (l.owner as unknown as { full_name: string } | null)?.full_name ?? null,
    })),
  });
}

const detailsSchema = z.object({
  requestId: uuid,
  leadId: uuid,
  version: z.number().int(),
  patch: z
    .object({
      customer_name: z.string().trim().min(1, "Name can't be empty.").max(200),
      phone: z.string().trim().min(1, "Phone can't be empty."),
      occasion_code: z.string().trim().max(80).nullable(),
      menu_code: z.string().trim().max(80).nullable(),
      guest_range: z.string().trim().max(40).nullable(),
      event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().or(z.literal("")),
      event_address: z.string().trim().max(500).nullable(),
      priority: z.enum(["low", "normal", "high"]),
      quoted_amount_inr: money,
      booking_value_inr: money,
    })
    .partial(),
});

export async function updateLeadDetails(input: z.input<typeof detailsSchema>): Promise<ActionResult<{ version: number }>> {
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const { patch, ...rest } = parsed.data;
  const rpcPatch: Record<string, unknown> = { ...patch };
  if (patch.phone !== undefined) {
    const phone = normalizePhone(patch.phone);
    if (phone.status !== "valid") return invalid(phone.status === "missing" ? "Enter a phone number." : phone.message, { phone: "Invalid" });
    delete rpcPatch.phone;
    rpcPatch.phone_e164 = phone.e164;
    rpcPatch.phone_raw = phone.raw;
  }
  for (const key of ["occasion_code", "menu_code"] as const) {
    if (typeof rpcPatch[key] === "string") rpcPatch[key] = (rpcPatch[key] as string).toLowerCase().replace(/\s+/g, "_") || null;
  }
  if (rpcPatch.event_date === "") rpcPatch.event_date = null;
  return call("update_lead_details", {
    p_request_id: rest.requestId,
    p_lead_id: rest.leadId,
    p_expected_version: rest.version,
    p_patch: rpcPatch,
  });
}

const stageSchema = z.object({
  requestId: uuid,
  leadId: uuid,
  version: z.number().int(),
  stage,
  reason: z.string().trim().max(500).optional().nullable(),
  pendingAction: z.enum(["cancel", "complete", "keep"]).optional().nullable(),
});

export async function changeStage(input: z.input<typeof stageSchema>): Promise<ActionResult<{ version: number; stage: string }>> {
  const parsed = stageSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const v = parsed.data;
  return call("change_lead_stage", {
    p_request_id: v.requestId,
    p_lead_id: v.leadId,
    p_expected_version: v.version,
    p_stage: v.stage,
    p_reason: v.reason || null,
    p_pending_action: v.pendingAction ?? null,
  });
}

const assignSchema = z.object({
  requestId: uuid,
  leadIds: z.array(uuid).min(1, "Select at least one lead.").max(1000, "Assign at most 1,000 leads at a time."),
  ownerId: uuid.nullable(),
  reason: z.string().trim().max(300).optional().nullable(),
});

export async function assignLeads(input: z.input<typeof assignSchema>): Promise<ActionResult<{ updated: number; unchanged: number; not_found: number }>> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const v = parsed.data;
  return call("assign_leads", {
    p_request_id: v.requestId,
    p_lead_ids: v.leadIds,
    p_owner_id: v.ownerId,
    p_reason: v.reason || null,
  });
}

/** Assign every lead matching the current filters (resolved on the server, under RLS). */
export async function assignMatchingLeads(input: {
  requestId: string;
  filters: Record<string, unknown>;
  ownerId: string | null;
  reason?: string | null;
  expectedCount: number;
}): Promise<ActionResult<{ updated: number; unchanged: number; not_found: number }>> {
  const supabase = await createClient();
  const { data, error, count } = await supabase
    .rpc("search_leads", { p_filters: input.filters ?? {} }, { count: "exact" })
    .select("id")
    .limit(1001);
  if (error) return fromDbError(error);
  if ((count ?? 0) > 1000) return invalid("More than 1,000 leads match. Narrow the filters and assign in parts.");
  if (count !== input.expectedCount) {
    return { ok: false, code: "conflict", message: `The matching leads changed (now ${count}). Review the list and try again.` };
  }
  return assignLeads({
    requestId: input.requestId,
    leadIds: ((data ?? []) as unknown as { id: string }[]).map((r) => r.id),
    ownerId: input.ownerId,
    reason: input.reason,
  });
}

const callSchema = z.object({
  requestId: uuid,
  leadId: uuid,
  version: z.number().int().optional().nullable(),
  outcome,
  note: z.string().max(5000).optional().nullable(),
  followUp: z.object({ dueAt: isoInstant, purpose: z.string().trim().min(1, "Add a purpose for the follow-up.").max(500) }).optional().nullable(),
  newStage: stage.optional().nullable(),
  completeFollowUpId: uuid.optional().nullable(),
});

export async function logCall(input: z.input<typeof callSchema>): Promise<ActionResult<{ call_log_id: string; stage: string }>> {
  const parsed = callSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const v = parsed.data;
  return call("log_call", {
    p_request_id: v.requestId,
    p_lead_id: v.leadId,
    p_outcome: v.outcome,
    p_note: v.note?.trim() || null,
    p_follow_up: v.followUp ? { due_at: new Date(v.followUp.dueAt).toISOString(), purpose: v.followUp.purpose } : null,
    p_new_stage: v.newStage ?? null,
    p_complete_follow_up_id: v.completeFollowUpId ?? null,
    p_expected_version: v.version ?? null,
  });
}

export async function addNote(input: { requestId: string; leadId: string; body: string }): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({ requestId: uuid, leadId: uuid, body: z.string().trim().min(1, "Write a note first.").max(5000) }).safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  return call("add_note", { p_request_id: parsed.data.requestId, p_lead_id: parsed.data.leadId, p_body: parsed.data.body });
}

export async function editNote(input: { requestId: string; noteId: string; version: number; body: string }): Promise<ActionResult<{ version: number }>> {
  const parsed = z
    .object({ requestId: uuid, noteId: uuid, version: z.number().int(), body: z.string().trim().min(1, "A note can't be empty.").max(5000) })
    .safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const v = parsed.data;
  return call("edit_note", { p_request_id: v.requestId, p_note_id: v.noteId, p_expected_version: v.version, p_body: v.body });
}

export async function getNoteHistory(noteId: string) {
  if (!uuid.safeParse(noteId).success) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("lead_note_revisions")
    .select("id, revision, body, edited_at, editor:profiles!lead_note_revisions_edited_by_fkey(full_name)")
    .eq("note_id", noteId)
    .order("revision", { ascending: false });
  return (data ?? []) as unknown as { id: string; revision: number; body: string; edited_at: string; editor: { full_name: string } | null }[];
}

export async function createFollowUp(input: { requestId: string; leadId: string; dueAt: string; purpose: string; assigneeId?: string | null }): Promise<ActionResult<{ id: string }>> {
  const parsed = z
    .object({ requestId: uuid, leadId: uuid, dueAt: isoInstant, purpose: z.string().trim().min(1, "Add a short purpose.").max(500), assigneeId: uuid.optional().nullable() })
    .safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const v = parsed.data;
  return call("create_follow_up", {
    p_request_id: v.requestId,
    p_lead_id: v.leadId,
    p_due_at: new Date(v.dueAt).toISOString(),
    p_purpose: v.purpose,
    p_assignee_id: v.assigneeId ?? null,
  });
}

export async function completeFollowUp(input: { requestId: string; id: string; version: number; outcome?: string }): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({ requestId: uuid, id: uuid, version: z.number().int(), outcome: z.string().trim().max(500).optional() }).safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const v = parsed.data;
  return call("complete_follow_up", { p_request_id: v.requestId, p_follow_up_id: v.id, p_expected_version: v.version, p_outcome: v.outcome || null });
}

export async function rescheduleFollowUp(input: { requestId: string; id: string; version: number; dueAt: string; reason?: string }): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({ requestId: uuid, id: uuid, version: z.number().int(), dueAt: isoInstant, reason: z.string().trim().max(300).optional() }).safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const v = parsed.data;
  return call("reschedule_follow_up", {
    p_request_id: v.requestId,
    p_follow_up_id: v.id,
    p_expected_version: v.version,
    p_due_at: new Date(v.dueAt).toISOString(),
    p_reason: v.reason || null,
  });
}

export async function cancelFollowUp(input: { requestId: string; id: string; version: number; reason: string }): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({ requestId: uuid, id: uuid, version: z.number().int(), reason: z.string().trim().min(1, "Give a reason.").max(300) }).safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const v = parsed.data;
  return call("cancel_follow_up", { p_request_id: v.requestId, p_follow_up_id: v.id, p_expected_version: v.version, p_reason: v.reason });
}
