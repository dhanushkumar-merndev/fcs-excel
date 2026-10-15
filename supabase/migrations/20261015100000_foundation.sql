-- Foundation: extensions, private schema, core tables.
-- Additive only. Safe to run on an empty project; refuses nothing destructive.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  email text not null,
  phone text,
  role text not null check (role in ('admin', 'manager', 'salesperson')),
  is_active boolean not null default true,
  invited_by uuid references public.profiles (id),
  invited_at timestamptz not null default now(),
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- Never leave the business without an active admin.
create or replace function private.protect_last_admin() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.role = 'admin' and old.is_active
     and (new.role <> 'admin' or not new.is_active)
     and not exists (
       select 1 from public.profiles p
       where p.id <> old.id and p.role = 'admin' and p.is_active
     ) then
    raise exception using errcode = 'CR422', message = 'At least one active admin is required.';
  end if;
  return new;
end $$;
create trigger profiles_protect_last_admin before update on public.profiles
  for each row execute function private.protect_last_admin();

-- ---------------------------------------------------------------------------
-- Business settings (singleton)
-- ---------------------------------------------------------------------------
create table public.business_settings (
  id smallint primary key default 1 check (id = 1),
  business_name text not null default 'FCS' check (length(btrim(business_name)) between 1 and 80),
  timezone text not null default 'Asia/Kolkata',
  currency text not null default 'INR',
  default_phone_country text not null default 'IN',
  reminder_lead_minutes int not null default 15 check (reminder_lead_minutes between 0 and 1440),
  salesperson_export_enabled boolean not null default false,
  lost_reasons text[] not null default array[
    'Price too high', 'Booked another caterer', 'Date not available',
    'Event cancelled', 'Stopped responding', 'Other'],
  unqualified_reasons text[] not null default array[
    'Outside service area', 'Guest count too small', 'Not a genuine enquiry',
    'Duplicate enquiry', 'Other'],
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
insert into public.business_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Imports (declared before leads, which reference batches)
-- ---------------------------------------------------------------------------
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  client_token uuid not null unique,
  file_name text not null check (length(file_name) between 1 and 255),
  file_size bigint,
  file_sha256 text,
  storage_path text,
  sheet_name text,
  column_mapping jsonb not null default '{}'::jsonb,
  event_year_choice jsonb,
  default_owner_id uuid references public.profiles (id),
  uploaded_by uuid not null references public.profiles (id),
  status text not null default 'staging'
    check (status in ('staging', 'ready', 'processing', 'completed', 'completed_with_issues', 'cancelled')),
  total_rows int not null default 0 check (total_rows between 0 and 1000),
  staged_rows int not null default 0,
  created_count int not null default 0,
  skipped_count int not null default 0,
  invalid_count int not null default 0,
  failed_count int not null default 0,
  pending_count int not null default 0,
  warning_count int not null default 0,
  review_count int not null default 0,
  completion_runs int not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  last_heartbeat_at timestamptz
);
create index import_batches_created_idx on public.import_batches (created_at desc);

-- ---------------------------------------------------------------------------
-- Leads: one row per event enquiry
-- ---------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  lead_number bigint generated always as identity (start with 1001) unique,
  customer_name text not null check (length(btrim(customer_name)) between 1 and 200),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  phone_raw text,
  occasion_code text,
  menu_code text,
  guest_range text,
  event_date date,
  event_date_raw text,
  event_date_status text not null default 'missing'
    check (event_date_status in ('confirmed', 'needs_review', 'missing')),
  event_address text,
  stage text not null default 'new' check (stage in (
    'new', 'contact_attempted', 'contacted', 'qualified', 'quote_sent',
    'negotiation', 'booked', 'lost', 'unqualified')),
  stage_rank smallint generated always as (case stage
    when 'new' then 1 when 'contact_attempted' then 2 when 'contacted' then 3
    when 'qualified' then 4 when 'quote_sent' then 5 when 'negotiation' then 6
    when 'booked' then 7 when 'lost' then 8 else 9 end) stored,
  closed_reason text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  owner_id uuid references public.profiles (id),
  assigned_at timestamptz,
  quoted_amount_inr numeric(12, 2) check (quoted_amount_inr >= 0),
  booking_value_inr numeric(12, 2) check (booking_value_inr >= 0),
  source_system text not null default 'manual' check (source_system in ('meta_lead_ads', 'manual')),
  external_lead_id text,
  external_lead_id_raw text,
  external_id_damaged boolean not null default false,
  source_fingerprint text,
  source_created_at timestamptz,
  acquired_at timestamptz generated always as (coalesce(source_created_at, created_at)) stored,
  ad_id text,
  ad_name text,
  adset_id text,
  adset_name text,
  campaign_id text,
  campaign_name text,
  form_id text,
  form_name text,
  is_organic boolean,
  platform text,
  source_status text,
  legacy_crm_update text,
  source_raw jsonb,
  review_flags text[] not null default '{}',
  import_batch_id uuid references public.import_batches (id),
  import_row_number int,
  first_dial_at timestamptz,
  first_call_logged_at timestamptz,
  next_follow_up_at timestamptz,
  last_activity_at timestamptz,
  closed_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  constraint leads_closed_reason_required check (
    stage not in ('lost', 'unqualified') or length(btrim(coalesce(closed_reason, ''))) > 0),
  constraint leads_source_external_unique unique (source_system, external_lead_id)
);
create unique index leads_source_fingerprint_key on public.leads (source_fingerprint)
  where source_fingerprint is not null;
create index leads_owner_idx on public.leads (owner_id, stage);
create index leads_stage_idx on public.leads (stage);
create index leads_event_date_idx on public.leads (event_date);
create index leads_acquired_idx on public.leads (acquired_at desc);
create index leads_created_idx on public.leads (created_at desc);
create index leads_phone_idx on public.leads (phone_e164);
create index leads_campaign_idx on public.leads (campaign_name);
create index leads_platform_idx on public.leads (platform);
create index leads_next_follow_up_idx on public.leads (next_follow_up_at) where next_follow_up_at is not null;
create index leads_import_batch_idx on public.leads (import_batch_id);
create index leads_name_trgm_idx on public.leads using gin (customer_name extensions.gin_trgm_ops);
create index leads_external_raw_idx on public.leads (external_lead_id_raw) where external_lead_id_raw is not null;
create trigger leads_touch before update on public.leads
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Activity
-- ---------------------------------------------------------------------------
create table public.call_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id),
  caller_id uuid not null references public.profiles (id),
  outcome text not null check (outcome in (
    'connected', 'no_answer', 'busy', 'switched_off', 'wrong_number', 'callback_requested')),
  called_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index call_logs_lead_idx on public.call_logs (lead_id, called_at desc);
create index call_logs_caller_idx on public.call_logs (caller_id, called_at desc);
create index call_logs_called_idx on public.call_logs (called_at);

create table public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id),
  author_id uuid not null references public.profiles (id),
  body text not null check (length(btrim(body)) between 1 and 5000),
  call_log_id uuid references public.call_logs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  version int not null default 1
);
create index lead_notes_lead_idx on public.lead_notes (lead_id, created_at desc);
create trigger lead_notes_touch before update on public.lead_notes
  for each row execute function private.touch_updated_at();

create table public.lead_note_revisions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.lead_notes (id),
  lead_id uuid not null references public.leads (id),
  revision int not null,
  body text not null,
  edited_by uuid not null references public.profiles (id),
  edited_at timestamptz not null default now(),
  unique (note_id, revision)
);
create index lead_note_revisions_note_idx on public.lead_note_revisions (note_id, revision desc);

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id),
  assignee_id uuid references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  due_at timestamptz not null,
  purpose text not null check (length(btrim(purpose)) between 1 and 500),
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  completed_at timestamptz,
  completed_by uuid references public.profiles (id),
  outcome text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancel_reason text,
  reminder_sent_at timestamptz,
  overdue_notified_at timestamptz,
  reschedule_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  constraint follow_ups_completed_consistent check ((status = 'completed') = (completed_at is not null)),
  constraint follow_ups_cancel_reason check (
    status <> 'cancelled' or length(btrim(coalesce(cancel_reason, ''))) > 0)
);
create index follow_ups_pending_assignee_idx on public.follow_ups (assignee_id, due_at) where status = 'pending';
create index follow_ups_pending_due_idx on public.follow_ups (due_at) where status = 'pending';
create index follow_ups_lead_idx on public.follow_ups (lead_id, status, due_at);
create index follow_ups_completed_idx on public.follow_ups (completed_at) where status = 'completed';
create trigger follow_ups_touch before update on public.follow_ups
  for each row execute function private.touch_updated_at();

-- Keep leads.next_follow_up_at = earliest pending follow-up.
create or replace function private.sync_next_follow_up() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_lead uuid := coalesce(new.lead_id, old.lead_id);
begin
  update public.leads l
     set next_follow_up_at = (
       select min(f.due_at) from public.follow_ups f
       where f.lead_id = v_lead and f.status = 'pending')
   where l.id = v_lead;
  return null;
end $$;
create trigger follow_ups_sync_next after insert or update of status, due_at or delete on public.follow_ups
  for each row execute function private.sync_next_follow_up();

create table public.lead_events (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads (id),
  actor_id uuid references public.profiles (id),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index lead_events_lead_idx on public.lead_events (lead_id, created_at desc);
create index lead_events_type_idx on public.lead_events (event_type, created_at);

-- Audit events are append-only for everyone, including privileged roles.
create or replace function private.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'CR403', message = 'Audit records cannot be modified.';
end $$;
create trigger lead_events_append_only before update or delete on public.lead_events
  for each row execute function private.forbid_mutation();

create table public.assignment_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id),
  previous_owner_id uuid references public.profiles (id),
  new_owner_id uuid references public.profiles (id),
  assigned_by uuid references public.profiles (id),
  reason text,
  transferred_follow_ups int not null default 0,
  created_at timestamptz not null default now()
);
create index assignment_history_lead_idx on public.assignment_history (lead_id, created_at desc);
create trigger assignment_history_append_only before update or delete on public.assignment_history
  for each row execute function private.forbid_mutation();

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches (id),
  row_number int not null check (row_number >= 1),
  raw jsonb not null,
  normalized jsonb,
  issues jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  decision text not null default 'import' check (decision in ('import', 'skip')),
  status text not null default 'pending' check (status in ('pending', 'created', 'skipped', 'invalid', 'failed')),
  skip_reason text,
  lead_id uuid references public.leads (id),
  error_message text,
  processed_at timestamptz,
  unique (batch_id, row_number)
);
create index import_rows_batch_status_idx on public.import_rows (batch_id, status, row_number);
create index import_rows_lead_idx on public.import_rows (lead_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id),
  type text not null check (type in (
    'lead_assigned', 'lead_reassigned_away', 'follow_up_due', 'follow_up_overdue',
    'import_completed', 'system')),
  lead_id uuid references public.leads (id),
  follow_up_id uuid references public.follow_ups (id),
  import_batch_id uuid references public.import_batches (id),
  title text not null,
  body text,
  link text,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_id) where read_at is null;

-- Business audit (staff, settings, exports) — lead history lives in lead_events.
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function private.forbid_mutation();

-- Idempotency for client-submitted mutations (double clicks, retries after timeouts).
create table private.request_log (
  request_id uuid primary key,
  user_id uuid,
  fn text not null,
  result jsonb,
  created_at timestamptz not null default now()
);
create index request_log_created_idx on private.request_log (created_at);
