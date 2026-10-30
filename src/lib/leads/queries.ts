import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  BusinessSettings,
  FollowUpRow,
  LeadEventRow,
  LeadHandoffRow,
  LeadPaymentRow,
  LeadWithOwner,
  NoteRow,
  ProfileRow,
  SalesTargetRow,
  WorkloadRow,
} from "@/lib/domain/types";
import type { Phase } from "@/lib/domain/stages";
import type { DeskMetricRow, PersonMetricRow } from "@/lib/domain/targets";
import { SORTS, toRpcFilters, type LeadFilters, type ListState } from "./filters";

export const LEAD_LIST_COLUMNS =
  "id, lead_number, customer_name, phone_e164, occasion_code, menu_code, guest_range, event_date, event_date_raw, event_date_status, event_address, stage, stage_rank, priority, owner_id, assigned_at, platform, campaign_name, ad_name, source_system, acquired_at, created_at, next_follow_up_at, last_activity_at, first_call_logged_at, review_flags, version, phase, service_type, owner:profiles!leads_owner_id_fkey(id, full_name)";

export async function listLeads(state: ListState) {
  const supabase = await createClient();
  const sort = SORTS[state.sort];
  const from = (state.page - 1) * state.size;
  let query = supabase
    .rpc("search_leads", { p_filters: toRpcFilters(state.filters) }, { count: "exact" })
    .select(LEAD_LIST_COLUMNS)
    .order(sort.column, { ascending: state.dir === "asc", nullsFirst: false });
  if (sort.column !== "lead_number") query = query.order("lead_number", { ascending: false });
  const { data, count, error } = await query.range(from, from + state.size - 1);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as unknown as LeadWithOwner[], total: count ?? 0 };
}

export async function countLeads(filters: LeadFilters) {
  const supabase = await createClient();
  const { count, error } = await supabase
    .rpc("search_leads", { p_filters: toRpcFilters(filters) }, { count: "exact", head: true })
    .select("id");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export type FilterOptions = { campaigns: string[]; ads: string[]; platforms: string[]; occasions: string[]; menus: string[] };

export async function getFilterOptions(): Promise<FilterOptions> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("lead_filter_options");
  return (data as FilterOptions) ?? { campaigns: [], ads: [], platforms: [], occasions: [], menus: [] };
}

export async function getTeam(): Promise<ProfileRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, username, phone, role, is_active, invited_at, deactivated_at, desk")
    .is("deleted_at", null)
    .order("full_name");
  return (data ?? []) as ProfileRow[];
}

export async function getWorkload(): Promise<WorkloadRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("team_workload");
  return (data ?? []) as WorkloadRow[];
}

export async function getSettings(): Promise<BusinessSettings> {
  const supabase = await createClient();
  const { data } = await supabase.from("business_settings").select("*").eq("id", 1).maybeSingle();
  return data as BusinessSettings;
}

export type LeadDetail = {
  lead: LeadWithOwner & Record<string, unknown>;
  followUps: (FollowUpRow & { assignee: { full_name: string } | null; completer: { full_name: string } | null })[];
  notes: (NoteRow & { author: { full_name: string } | null; revisions: { count: number }[] })[];
  events: (LeadEventRow & { actor: { full_name: string } | null })[];
  related: Pick<LeadWithOwner, "id" | "lead_number" | "customer_name" | "event_date" | "stage" | "occasion_code" | "acquired_at" | "owner">[];
  importInfo: { id: string; file_name: string; sheet_name: string | null; created_at: string } | null;
  payments: (LeadPaymentRow & { recorder: { full_name: string } | null })[];
  handoffs: (LeadHandoffRow & { from_owner: { full_name: string } | null; to_owner: { full_name: string } | null })[];
};

export async function getLeadDetail(id: string): Promise<LeadDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("*, owner:profiles!leads_owner_id_fkey(id, full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!lead) return null;

  const [followUps, notes, events, related, batch, payments, handoffs] = await Promise.all([
    supabase
      .from("follow_ups")
      .select("*, assignee:profiles!follow_ups_assignee_id_fkey(full_name), completer:profiles!follow_ups_completed_by_fkey(full_name)")
      .eq("lead_id", id)
      .order("status", { ascending: false })
      .order("due_at", { ascending: true }),
    supabase
      .from("lead_notes")
      .select("*, author:profiles!lead_notes_author_id_fkey(full_name), revisions:lead_note_revisions(count)")
      .eq("lead_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("lead_events")
      .select("*, actor:profiles!lead_events_actor_id_fkey(full_name)")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(300),
    supabase
      .from("leads")
      .select("id, lead_number, customer_name, event_date, stage, occasion_code, acquired_at, owner:profiles!leads_owner_id_fkey(id, full_name)")
      .eq("phone_e164", lead.phone_e164)
      .neq("id", id)
      .order("acquired_at", { ascending: false })
      .limit(20),
    lead.import_batch_id
      ? supabase.from("import_batches").select("id, file_name, sheet_name, created_at").eq("id", lead.import_batch_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("lead_payments")
      .select("*, recorder:profiles!lead_payments_recorded_by_fkey(full_name)")
      .eq("lead_id", id)
      .order("paid_on", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("lead_handoffs")
      .select("*, from_owner:profiles!lead_handoffs_from_owner_id_fkey(full_name), to_owner:profiles!lead_handoffs_to_owner_id_fkey(full_name)")
      .eq("lead_id", id)
      .order("created_at", { ascending: true }),
  ]);

  return {
    lead: lead as LeadDetail["lead"],
    followUps: (followUps.data ?? []) as LeadDetail["followUps"],
    notes: (notes.data ?? []) as LeadDetail["notes"],
    events: (events.data ?? []) as LeadDetail["events"],
    related: (related.data ?? []) as unknown as LeadDetail["related"],
    importInfo: (batch.data as LeadDetail["importInfo"]) ?? null,
    payments: (payments.data ?? []) as unknown as LeadDetail["payments"],
    handoffs: (handoffs.data ?? []) as unknown as LeadDetail["handoffs"],
  };
}

export async function getNoteRevisions(noteId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lead_note_revisions")
    .select("id, revision, body, edited_at, editor:profiles!lead_note_revisions_edited_by_fkey(full_name)")
    .eq("note_id", noteId)
    .order("revision", { ascending: false });
  return data ?? [];
}

export type RoundRobinInfo = {
  enabled: boolean;
  /** Active salespeople in rotation order (the order they joined). */
  members: { id: string; full_name: string; in_round_robin: boolean }[];
  nextId: string | null;
  unassignedOpen: number;
};

export async function getRoundRobin(): Promise<RoundRobinInfo> {
  const supabase = await createClient();
  const [settings, members, next, unassignedOpen] = await Promise.all([
    supabase.from("business_settings").select("round_robin_enabled").eq("id", 1).maybeSingle(),
    supabase
      .from("profiles")
      .select("id, full_name, in_round_robin")
      .eq("role", "salesperson")
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("created_at")
      .order("id"),
    supabase.rpc("round_robin_next"),
    countLeads({ owner: ["unassigned"], stage_group: "open" }),
  ]);
  if (members.error) throw new Error(members.error.message);
  return {
    enabled: settings.data?.round_robin_enabled ?? false,
    members: members.data ?? [],
    nextId: (next.data as string | null) ?? null,
    unassignedOpen,
  };
}

export type PipelineInfo = {
  enabled: boolean;
  slaMinutes: number;
  /** Active salespeople, in rotation order (the order they joined). */
  members: { id: string; full_name: string; desk: Phase | null; in_round_robin: boolean }[];
  next: Record<Phase, string | null>;
};

export async function getPipeline(): Promise<PipelineInfo> {
  const supabase = await createClient();
  const [settings, members, next] = await Promise.all([
    supabase.from("business_settings").select("pipeline_enabled, first_call_sla_minutes").eq("id", 1).maybeSingle(),
    supabase
      .from("profiles")
      .select("id, full_name, desk, in_round_robin")
      .eq("role", "salesperson")
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("created_at")
      .order("id"),
    supabase.rpc("desk_next"),
  ]);
  if (members.error) throw new Error(members.error.message);
  return {
    enabled: settings.data?.pipeline_enabled ?? false,
    slaMinutes: settings.data?.first_call_sla_minutes ?? 15,
    members: (members.data ?? []) as PipelineInfo["members"],
    next: ((next.data as PipelineInfo["next"] | null) ?? { lead_desk: null, qualification: null, closing: null, operations: null }),
  };
}

/** The month's saved plan ("YYYY-MM-01"), or null to use the default plan. */
export async function getSalesTarget(month: string): Promise<SalesTargetRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("sales_targets").select("*").eq("month", month).maybeSingle();
  return (data as SalesTargetRow | null) ?? null;
}

export type PipelineKpis = {
  desks: DeskMetricRow[];
  people: PersonMetricRow[];
  loss_reasons: { desk: Phase; reason: string; leads: number }[];
  calls: { attempted: number; connected: number; leads: number };
  quotes: { sent: number; value: number };
  follow_ups: { due: number; completed: number; overdue_now: number };
  bookings: { count: number; gross: number; by_service: { service: string; count: number; gross: number }[] };
  payments: { advance: number; balance: number; refund: number };
  realized: number;
  outstanding: number;
  hygiene: { no_next_action: number; unassigned: number; sla_breaches: number; awaiting_handover: number };
  sla_minutes: number;
  scope: "team" | "me";
  generated_at: string;
};

/** Desk flows and the daily-report numbers for an IST date range (inclusive). */
export async function getPipelineKpis(from: string, to: string): Promise<PipelineKpis> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pipeline_kpis", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  const k = data as PipelineKpis;
  const num = (v: unknown) => Number(v ?? 0);
  return {
    ...k,
    desks: (k.desks ?? []).map((r) => ({ ...r, leads: num(r.leads) })),
    people: (k.people ?? []).map((r) => ({ ...r, leads: num(r.leads) })),
    loss_reasons: (k.loss_reasons ?? []).map((r) => ({ ...r, leads: num(r.leads) })),
    quotes: { sent: num(k.quotes?.sent), value: num(k.quotes?.value) },
    bookings: {
      count: num(k.bookings?.count),
      gross: num(k.bookings?.gross),
      by_service: (k.bookings?.by_service ?? []).map((b) => ({ service: b.service, count: num(b.count), gross: num(b.gross) })),
    },
    payments: { advance: num(k.payments?.advance), balance: num(k.payments?.balance), refund: num(k.payments?.refund) },
    realized: num(k.realized),
    outstanding: num(k.outstanding),
  };
}
