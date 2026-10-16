import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  BusinessSettings,
  FollowUpRow,
  LeadEventRow,
  LeadWithOwner,
  NoteRow,
  ProfileRow,
  WorkloadRow,
} from "@/lib/domain/types";
import { SORTS, toRpcFilters, type LeadFilters, type ListState } from "./filters";

export const LEAD_LIST_COLUMNS =
  "id, lead_number, customer_name, phone_e164, occasion_code, menu_code, guest_range, event_date, event_date_raw, event_date_status, event_address, stage, stage_rank, priority, owner_id, assigned_at, platform, campaign_name, ad_name, source_system, acquired_at, created_at, next_follow_up_at, last_activity_at, first_call_logged_at, review_flags, version, owner:profiles!leads_owner_id_fkey(id, full_name)";

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
    .select("id, full_name, username, phone, role, is_active, invited_at, deactivated_at")
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

  const [followUps, notes, events, related, batch] = await Promise.all([
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
  ]);

  return {
    lead: lead as LeadDetail["lead"],
    followUps: (followUps.data ?? []) as LeadDetail["followUps"],
    notes: (notes.data ?? []) as LeadDetail["notes"],
    events: (events.data ?? []) as LeadDetail["events"],
    related: (related.data ?? []) as unknown as LeadDetail["related"],
    importInfo: (batch.data as LeadDetail["importInfo"]) ?? null,
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
