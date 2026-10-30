"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { fromDbError, invalid, ok, type ActionResult } from "@/lib/action-result";
import { PHASES } from "@/lib/domain/stages";
import { createClient } from "@/lib/supabase/server";

/**
 * BDE pipeline actions. Every rule (who may hand off, requirements, advance before booking) is
 * enforced in Postgres (supabase/migrations/20261105100000_bde_pipeline.sql); these only validate
 * shape and map errors.
 */

const uuid = z.string().uuid();
const phase = z.enum(PHASES.map((p) => p.value) as [string, ...string[]]);
const amount = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "string" ? Number(v.replace(/[,\s₹]/g, "")) : v))
  .refine((v) => Number.isFinite(v) && v > 0 && v < 1e10, "Enter an amount above zero.");

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

export type HandoffResult = { version: number; phase: string; stage: string; owner_id: string | null; owner_name: string | null };

const handoffSchema = z.object({
  requestId: uuid,
  leadId: uuid,
  version: z.number().int(),
  toPhase: phase,
  note: z.string().trim().min(1, "Add a note for the next desk.").max(5000),
  ownerId: uuid.optional().nullable(),
});

export async function handoffLead(input: z.input<typeof handoffSchema>): Promise<ActionResult<HandoffResult>> {
  const parsed = handoffSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const v = parsed.data;
  return call("handoff_lead", {
    p_request_id: v.requestId,
    p_lead_id: v.leadId,
    p_expected_version: v.version,
    p_to_phase: v.toPhase,
    p_note: v.note,
    p_owner_id: v.ownerId ?? null,
  });
}

const paymentSchema = z.object({
  requestId: uuid,
  leadId: uuid,
  kind: z.enum(["advance", "balance", "refund"]),
  amount,
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date it was received."),
  mode: z.enum(["upi", "cash", "bank_transfer", "card", "other"]).optional().nullable(),
  reference: z.string().trim().max(200).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

export async function recordPayment(input: z.input<typeof paymentSchema>): Promise<ActionResult<{ id: string; paid_total: number }>> {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const v = parsed.data;
  return call("record_payment", {
    p_request_id: v.requestId,
    p_lead_id: v.leadId,
    p_kind: v.kind,
    p_amount: v.amount,
    p_paid_on: v.paidOn,
    p_mode: v.mode ?? null,
    p_reference: v.reference || null,
    p_note: v.note || null,
  });
}

const bookingSchema = z.object({
  requestId: uuid,
  leadId: uuid,
  version: z.number().int(),
  bookingValue: amount,
  pendingAction: z.enum(["cancel", "complete", "keep"]).optional().nullable(),
  ownerId: uuid.optional().nullable(),
});

export async function confirmBooking(
  input: z.input<typeof bookingSchema>,
): Promise<ActionResult<HandoffResult & { handed_to_operations: boolean }>> {
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const v = parsed.data;
  return call("confirm_booking", {
    p_request_id: v.requestId,
    p_lead_id: v.leadId,
    p_expected_version: v.version,
    p_booking_value: v.bookingValue,
    p_pending_action: v.pendingAction ?? null,
    p_owner_id: v.ownerId ?? null,
  });
}

const opsSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("acknowledge") }),
  z.object({
    action: z.literal("chef"),
    chefName: z.string().trim().min(1, "Enter the chef's name.").max(120),
    chefPhone: z.string().trim().max(40).optional().nullable(),
    opsNotes: z.string().trim().max(2000).optional().nullable(),
  }),
  z.object({ action: z.literal("complete"), note: z.string().trim().max(5000).optional().nullable() }),
]);

export async function opsUpdate(
  input: { requestId: string; leadId: string; version: number } & z.input<typeof opsSchema>,
): Promise<ActionResult<{ version: number }>> {
  const base = z.object({ requestId: uuid, leadId: uuid, version: z.number().int() }).safeParse(input);
  if (!base.success) return firstIssue(base.error);
  const parsed = opsSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const v = parsed.data;
  const payload =
    v.action === "chef"
      ? { chef_name: v.chefName, chef_phone: v.chefPhone || null, ops_notes: v.opsNotes || null }
      : v.action === "complete"
        ? { note: v.note || null }
        : {};
  return call("ops_update", {
    p_request_id: base.data.requestId,
    p_lead_id: base.data.leadId,
    p_expected_version: base.data.version,
    p_action: v.action,
    p_payload: payload,
  });
}

const pipelineSchema = z.object({
  enabled: z.boolean(),
  desks: z.record(uuid, phase.nullable()),
  slaMinutes: z.coerce.number().int().min(1, "Use at least 1 minute.").max(1440, "Use at most 1,440 minutes."),
});

/** Admin: who sits on which desk, the first-call target, and the on/off switch. */
export async function updatePipeline(
  input: z.input<typeof pipelineSchema>,
): Promise<ActionResult<{ enabled: boolean; next: Record<string, string | null> }>> {
  const parsed = pipelineSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const v = parsed.data;
  return call("update_pipeline", { p_enabled: v.enabled, p_desks: v.desks, p_sla_minutes: v.slaMinutes });
}

const pctField = z.coerce.number().min(0, "Use 0–100%.").max(100, "Use 0–100%.");
const targetSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/, "Choose a month."),
  leadsPerDay: z.coerce.number().int().min(0).max(10000),
  workingDays: z.coerce.number().int().min(1, "Use 1–31 working days.").max(31, "Use 1–31 working days."),
  pushRate: pctField,
  qualificationRate: pctField,
  closingRate: pctField,
  chefTicket: z.coerce.number().min(0).max(1e9),
  cateringTicket: z.coerce.number().min(0).max(1e9),
  chefMixPct: pctField,
});

/** Managers and admins: the month's plan. */
export async function saveSalesTarget(input: z.input<typeof targetSchema>): Promise<ActionResult<null>> {
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const v = parsed.data;
  const result = await call("upsert_sales_target", {
    p_month: v.month,
    p_values: {
      leads_per_day: v.leadsPerDay,
      working_days: v.workingDays,
      push_rate: v.pushRate,
      qualification_rate: v.qualificationRate,
      closing_rate: v.closingRate,
      chef_ticket_inr: v.chefTicket,
      catering_ticket_inr: v.cateringTicket,
      chef_mix_pct: v.chefMixPct,
    },
  });
  return result.ok ? ok(null) : result;
}
