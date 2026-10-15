-- Access control: role helpers, RLS policies, grants.
-- Roles come only from public.profiles (never JWT/user metadata). Inactive staff resolve to no role.

create or replace function private.staff_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active)
$$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.staff_role() = 'admin', false)
$$;

create or replace function private.is_manager_or_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.staff_role() in ('admin', 'manager'), false)
$$;

create or replace function private.can_access_lead(p_lead_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and (private.is_manager_or_admin() or (l.owner_id = auth.uid() and private.is_staff()))
  )
$$;

-- Raisers used by RPCs. Error codes: CR401 not signed in / inactive, CR403 forbidden,
-- CR404 not found (or not visible), CR409 version conflict, CR422 validation.
create or replace function private.require_staff() returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.staff_role();
begin
  if v_role is null then
    raise exception using errcode = 'CR401', message = 'Your session is not active. Please sign in again.';
  end if;
  return v_role;
end $$;

create or replace function private.require_manager() returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.require_staff();
begin
  if v_role not in ('admin', 'manager') then
    raise exception using errcode = 'CR403', message = 'Only an admin or manager can do this.';
  end if;
  return v_role;
end $$;

create or replace function private.require_admin() returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.require_staff();
begin
  if v_role <> 'admin' then
    raise exception using errcode = 'CR403', message = 'Only an admin can do this.';
  end if;
  return v_role;
end $$;

-- Locks and returns a lead the caller may modify. Missing and forbidden are indistinguishable.
create or replace function private.lock_lead_for_write(p_lead_id uuid) returns public.leads
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.require_staff();
  v_lead public.leads;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found or (v_role = 'salesperson' and v_lead.owner_id is distinct from auth.uid()) then
    raise exception using errcode = 'CR404', message = 'Lead not found or you do not have access to it.';
  end if;
  return v_lead;
end $$;

create or replace function private.check_version(p_actual int, p_expected int) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_expected is not null and p_actual <> p_expected then
    raise exception using errcode = 'CR409',
      message = 'This record was changed by someone else. Reload to see the latest version.';
  end if;
end $$;

-- Idempotency: returns the stored result for a replayed request id, or null when the
-- request is claimed for the first time. A concurrent duplicate blocks on the unique
-- index until the first transaction finishes, then replays its result.
create or replace function private.claim_request(p_request_id uuid, p_fn text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_user uuid;
begin
  if p_request_id is null then
    return null;
  end if;
  insert into private.request_log (request_id, user_id, fn)
  values (p_request_id, auth.uid(), p_fn)
  on conflict (request_id) do nothing;
  if found then
    return null;
  end if;
  select r.result, r.user_id into v_result, v_user from private.request_log r where r.request_id = p_request_id;
  if v_user is distinct from auth.uid() then
    raise exception using errcode = 'CR422', message = 'Invalid request id.';
  end if;
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('replayed', true);
end $$;

create or replace function private.finish_request(p_request_id uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_request_id is not null then
    update private.request_log set result = p_result where request_id = p_request_id;
  end if;
  return p_result;
end $$;

create or replace function private.log_event(p_lead_id uuid, p_type text, p_payload jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.lead_events (lead_id, actor_id, event_type, payload)
  values (p_lead_id, auth.uid(), p_type, coalesce(p_payload, '{}'::jsonb));
$$;

create or replace function private.audit(p_action text, p_entity_type text, p_entity_id text, p_payload jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_id, action, entity_type, entity_id, payload)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_payload, '{}'::jsonb));
$$;

create or replace function private.staff_name(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select full_name from public.profiles where id = p_id
$$;

-- Only the predicates used inside RLS policies need to be executable by end users.
alter default privileges in schema private revoke execute on functions from public;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.staff_role(), private.is_staff(), private.is_admin(),
  private.is_manager_or_admin(), private.can_access_lead(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.business_settings enable row level security;
alter table public.import_batches enable row level security;
alter table public.leads enable row level security;
alter table public.call_logs enable row level security;
alter table public.lead_notes enable row level security;
alter table public.lead_note_revisions enable row level security;
alter table public.follow_ups enable row level security;
alter table public.lead_events enable row level security;
alter table public.assignment_history enable row level security;
alter table public.import_rows enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;
alter table private.request_log enable row level security;

-- Reads only. Every write goes through SECURITY DEFINER functions that check permissions.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated;
grant select on
  public.profiles, public.business_settings, public.import_batches, public.leads,
  public.call_logs, public.lead_notes, public.lead_note_revisions, public.follow_ups,
  public.lead_events, public.assignment_history, public.import_rows, public.notifications,
  public.audit_log
to authenticated;

-- Future tables in public are not exposed until explicitly granted.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

create policy "staff read team" on public.profiles
  for select to authenticated using ((select private.is_staff()));

create policy "staff read settings" on public.business_settings
  for select to authenticated using ((select private.is_staff()));

create policy "leads visible to managers or owner" on public.leads
  for select to authenticated using (
    (select private.is_manager_or_admin())
    or (owner_id = (select auth.uid()) and (select private.is_staff()))
  );

create policy "call logs follow lead access" on public.call_logs
  for select to authenticated using (private.can_access_lead(lead_id));
create policy "notes follow lead access" on public.lead_notes
  for select to authenticated using (private.can_access_lead(lead_id));
create policy "note revisions follow lead access" on public.lead_note_revisions
  for select to authenticated using (private.can_access_lead(lead_id));
create policy "follow-ups follow lead access" on public.follow_ups
  for select to authenticated using (private.can_access_lead(lead_id));
create policy "events follow lead access" on public.lead_events
  for select to authenticated using (private.can_access_lead(lead_id));
create policy "assignment history follows lead access" on public.assignment_history
  for select to authenticated using (private.can_access_lead(lead_id));

create policy "imports for managers" on public.import_batches
  for select to authenticated using ((select private.is_manager_or_admin()));
create policy "import rows for managers" on public.import_rows
  for select to authenticated using ((select private.is_manager_or_admin()));

create policy "own notifications" on public.notifications
  for select to authenticated using (recipient_id = (select auth.uid()) and (select private.is_staff()));

create policy "audit for admins" on public.audit_log
  for select to authenticated using ((select private.is_admin()));
