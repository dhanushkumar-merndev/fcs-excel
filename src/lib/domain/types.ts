export type Role = "admin" | "manager" | "salesperson";

export type Staff = {
  id: string;
  fullName: string;
  username: string;
  role: Role;
};

export type ProfileRow = {
  id: string;
  full_name: string;
  username: string;
  phone: string | null;
  role: Role;
  is_active: boolean;
  invited_at: string;
  deactivated_at: string | null;
};

export type LeadRow = {
  id: string;
  lead_number: number;
  customer_name: string;
  phone_e164: string;
  phone_raw: string | null;
  occasion_code: string | null;
  menu_code: string | null;
  guest_range: string | null;
  event_date: string | null;
  event_date_raw: string | null;
  event_date_status: "confirmed" | "needs_review" | "missing";
  event_address: string | null;
  stage: string;
  stage_rank: number;
  closed_reason: string | null;
  priority: "low" | "normal" | "high";
  owner_id: string | null;
  assigned_at: string | null;
  quoted_amount_inr: string | number | null;
  booking_value_inr: string | number | null;
  source_system: "meta_lead_ads" | "manual";
  external_lead_id: string | null;
  external_lead_id_raw: string | null;
  external_id_damaged: boolean;
  source_created_at: string | null;
  acquired_at: string;
  ad_id: string | null;
  ad_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  form_id: string | null;
  form_name: string | null;
  is_organic: boolean | null;
  platform: string | null;
  source_status: string | null;
  legacy_crm_update: string | null;
  source_raw: Record<string, unknown> | null;
  review_flags: string[];
  import_batch_id: string | null;
  import_row_number: number | null;
  first_dial_at: string | null;
  first_call_logged_at: string | null;
  next_follow_up_at: string | null;
  last_activity_at: string | null;
  closed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type LeadWithOwner = LeadRow & { owner: { id: string; full_name: string } | null };

export type FollowUpRow = {
  id: string;
  lead_id: string;
  assignee_id: string | null;
  created_by: string;
  due_at: string;
  purpose: string;
  status: "pending" | "completed" | "cancelled";
  completed_at: string | null;
  completed_by: string | null;
  outcome: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  reschedule_count: number;
  created_at: string;
  version: number;
};

export type NoteRow = {
  id: string;
  lead_id: string;
  author_id: string;
  body: string;
  call_log_id: string | null;
  created_at: string;
  edited_at: string | null;
  version: number;
};

export type LeadEventRow = {
  id: number;
  lead_id: string;
  actor_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type ImportBatchRow = {
  id: string;
  client_token: string;
  file_name: string;
  file_size: number | null;
  sheet_name: string | null;
  default_owner_id: string | null;
  uploaded_by: string;
  status: "staging" | "ready" | "processing" | "completed" | "completed_with_issues" | "cancelled";
  total_rows: number;
  staged_rows: number;
  created_count: number;
  skipped_count: number;
  invalid_count: number;
  failed_count: number;
  pending_count: number;
  warning_count: number;
  review_count: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  last_heartbeat_at: string | null;
  storage_path: string | null;
};

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  lead_id: string | null;
  created_at: string;
  read_at: string | null;
};

export type BusinessSettings = {
  business_name: string;
  timezone: string;
  currency: string;
  default_phone_country: string;
  reminder_lead_minutes: number;
  salesperson_export_enabled: boolean;
  lost_reasons: string[];
  unqualified_reasons: string[];
  updated_at: string;
};

export type WorkloadRow = {
  id: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  open_leads: number;
  overdue_follow_ups: number;
  due_today: number;
  assigned_last_7_days: number;
};
