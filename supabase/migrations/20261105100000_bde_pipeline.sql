-- BDE pipeline: four desks, each staffed by its own salespeople, and a lead moves desk to desk.
--
--   BDE 1 lead desk      calls every new lead; interested ones are pushed to BDE 2
--   BDE 2 qualification  works interested leads; fully qualified ones are pushed to BDE 3
--   BDE 3 closing        quotes, follows up, collects the advance → booking confirmed → BDE 4
--   BDE 4 operations     acknowledges the handover, assigns the chef, completes the event
--
-- A lead can be lost at any desk. Each handoff gives the lead to the next desk's person in turn,
-- so its owner is always whoever is working it now. Payments are an append-only ledger.
--
-- Production safety: additive only. Nothing changes for anyone until an admin assigns desks and
-- turns on business_settings.pipeline_enabled. Existing function signatures are unchanged, so an
-- older deployment keeps working while this rolls out. Booked leads stay 'booked' (operations
-- progress lives in its own columns), so every existing report, dashboard and reminder that treats
-- booked / lost / unqualified as closed stays correct. The two new stages are open stages.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.profiles add column desk text
  check (desk in ('lead_desk', 'qualification', 'closing', 'operations'));
comment on column public.profiles.desk is 'BDE desk (salespeople only). Null = not on a desk.';

alter table public.business_settings
  add column pipeline_enabled boolean not null default false,
  add column first_call_sla_minutes int not null default 15 check (first_call_sla_minutes between 1 and 1440);

alter table public.leads
  add column phase text not null default 'lead_desk'
    check (phase in ('lead_desk', 'qualification', 'closing', 'operations')),
  add column service_type text check (service_type in ('chef_on_demand', 'catering')),
  add column budget_inr numeric(12, 2) check (budget_inr >= 0),
  add column handover_acknowledged_at timestamptz,
  add column handover_acknowledged_by uuid references public.profiles (id),
  add column chef_name text check (chef_name is null or length(chef_name) between 1 and 120),
  add column chef_phone text check (chef_phone is null or length(chef_phone) <= 40),
  add column chef_assigned_at timestamptz,
  add column ops_notes text check (ops_notes is null or length(ops_notes) <= 2000),
  add column event_completed_at timestamptz;
comment on column public.leads.phase is 'The BDE desk that has (or last had) the lead. For closed leads: the desk where it closed.';
create index leads_phase_idx on public.leads (phase, stage);
create index leads_event_completed_idx on public.leads (event_completed_at) where event_completed_at is not null;

-- Existing leads take the desk their stage belongs to. Owners are untouched. The touch trigger is
-- paused so this bookkeeping doesn't look like an edit to every lead.
alter table public.leads disable trigger leads_touch;
update public.leads
   set phase = case when stage in ('qualified', 'quote_sent', 'negotiation') then 'closing' else 'operations' end
 where stage in ('qualified', 'quote_sent', 'negotiation', 'booked');
alter table public.leads enable trigger leads_touch;

-- ---------------------------------------------------------------------------
-- Stages: + interested (with BDE 2), + advance_pending (BDE 3, waiting for the advance)
-- ---------------------------------------------------------------------------
alter table public.leads drop constraint leads_stage_check;
alter table public.leads add constraint leads_stage_check check (stage in (
  'new', 'contact_attempted', 'contacted', 'interested', 'qualified', 'quote_sent',
  'negotiation', 'advance_pending', 'booked', 'lost', 'unqualified'));

-- Sort order only (nothing compares ranks numerically).
do $$
declare
  v_expr text := $e$case stage
    when 'new' then 1 when 'contact_attempted' then 2 when 'contacted' then 3 when 'interested' then 4
    when 'qualified' then 5 when 'quote_sent' then 6 when 'negotiation' then 7 when 'advance_pending' then 8
    when 'booked' then 9 when 'lost' then 10 else 11 end$e$;
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute format('alter table public.leads alter column stage_rank set expression as (%s)', v_expr);
  else
    alter table public.leads drop column stage_rank;
    execute format('alter table public.leads add column stage_rank smallint generated always as (%s) stored', v_expr);
  end if;
end $$;

create or replace function private.valid_stage(p_stage text) returns boolean
language sql immutable set search_path = '' as $$
  select p_stage in ('new', 'contact_attempted', 'contacted', 'interested', 'qualified', 'quote_sent',
                     'negotiation', 'advance_pending', 'booked', 'lost', 'unqualified')
$$;

-- ---------------------------------------------------------------------------
-- New tables
-- ---------------------------------------------------------------------------
create table public.lead_payments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id),
  kind text not null check (kind in ('advance', 'balance', 'refund')),
  amount_inr numeric(12, 2) not null check (amount_inr > 0),
  paid_on date not null,
  mode text check (mode in ('upi', 'cash', 'bank_transfer', 'card', 'other')),
  reference text check (reference is null or length(reference) <= 200),
  note text check (note is null or length(note) <= 500),
  recorded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index lead_payments_lead_idx on public.lead_payments (lead_id, paid_on);
create index lead_payments_paid_idx on public.lead_payments (paid_on);
create trigger lead_payments_append_only before update or delete on public.lead_payments
  for each row execute function private.forbid_mutation();

-- Every move between desks. The source of truth for desk KPIs.
create table public.lead_handoffs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id),
  from_phase text not null check (from_phase in ('lead_desk', 'qualification', 'closing', 'operations')),
  to_phase text not null check (to_phase in ('lead_desk', 'qualification', 'closing', 'operations')),
  from_owner_id uuid references public.profiles (id),
  to_owner_id uuid references public.profiles (id),
  by_id uuid references public.profiles (id),
  note text,
  created_at timestamptz not null default now()
);
create index lead_handoffs_lead_idx on public.lead_handoffs (lead_id, created_at desc);
create index lead_handoffs_to_idx on public.lead_handoffs (to_phase, created_at);
create index lead_handoffs_from_idx on public.lead_handoffs (from_phase, created_at);
create trigger lead_handoffs_append_only before update or delete on public.lead_handoffs
  for each row execute function private.forbid_mutation();

-- Whose turn is next on each desk (same scheme as round_robin_state).
create table public.desk_rotation (
  desk text primary key check (desk in ('lead_desk', 'qualification', 'closing', 'operations')),
  last_profile_id uuid,
  last_joined_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Monthly plan. A month without a row uses the column defaults (the standard planning scenario).
create table public.sales_targets (
  month date primary key check (extract(day from month) = 1),
  leads_per_day int not null default 40 check (leads_per_day between 0 and 10000),
  working_days int not null default 26 check (working_days between 1 and 31),
  push_rate numeric(5, 2) not null default 100 check (push_rate between 0 and 100),
  qualification_rate numeric(5, 2) not null default 70 check (qualification_rate between 0 and 100),
  closing_rate numeric(5, 2) not null default 40 check (closing_rate between 0 and 100),
  chef_ticket_inr numeric(12, 2) not null default 2500 check (chef_ticket_inr >= 0),
  catering_ticket_inr numeric(12, 2) not null default 40000 check (catering_ticket_inr >= 0),
  chef_mix_pct numeric(5, 2) not null default 80 check (chef_mix_pct between 0 and 100),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

alter table public.lead_payments enable row level security;
alter table public.lead_handoffs enable row level security;
alter table public.desk_rotation enable row level security;
alter table public.sales_targets enable row level security;
grant select on public.lead_payments, public.lead_handoffs, public.sales_targets to authenticated;
create policy "payments follow lead access" on public.lead_payments
  for select to authenticated using (private.can_access_lead(lead_id));
create policy "handoffs follow lead access" on public.lead_handoffs
  for select to authenticated using (private.can_access_lead(lead_id));
create policy "staff read targets" on public.sales_targets
  for select to authenticated using ((select private.is_staff()));

-- Reasons the desks need, added only when missing and kept before "Other". Nothing is removed.
create or replace function private.merge_reasons(p_current text[], p_add text[]) returns text[]
language sql immutable set search_path = '' as $$
  select array(select x from unnest(p_current) with ordinality u(x, i) where x <> 'Other' order by i)
      || array(select a from unnest(p_add) with ordinality v(a, j) where not a = any (p_current) order by j)
      || case when 'Other' = any (p_current) then array['Other'] else '{}'::text[] end
$$;
update public.business_settings
   set unqualified_reasons = private.merge_reasons(unqualified_reasons, array['Not interested', 'Invalid enquiry', 'Duplicate enquiry']),
       lost_reasons = private.merge_reasons(lost_reasons, array['Advance not paid', 'Booking cancelled'])
 where id = 1;

-- ---------------------------------------------------------------------------
-- Desk helpers
-- ---------------------------------------------------------------------------
create or replace function private.pipeline_on() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select pipeline_enabled from public.business_settings where id = 1), false)
$$;

create or replace function private.phase_rank(p_phase text) returns int
language sql immutable set search_path = '' as $$
  select case p_phase when 'lead_desk' then 1 when 'qualification' then 2 when 'closing' then 3
                      when 'operations' then 4 end
$$;

create or replace function private.phase_label(p_phase text) returns text
language sql immutable set search_path = '' as $$
  select case p_phase when 'lead_desk' then 'BDE 1 (lead desk)' when 'qualification' then 'BDE 2 (qualification)'
                      when 'closing' then 'BDE 3 (closing)' when 'operations' then 'BDE 4 (operations)' end
$$;

-- The desk a stage belongs to (null for lost/unqualified, which close the lead wherever it is).
create or replace function private.phase_for_stage(p_stage text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_stage in ('new', 'contact_attempted', 'contacted') then 'lead_desk'
    when p_stage = 'interested' then 'qualification'
    when p_stage in ('qualified', 'quote_sent', 'negotiation', 'advance_pending') then 'closing'
    when p_stage = 'booked' then 'operations'
  end
$$;

-- With the pipeline on, the stages each desk may set. Booked only comes from confirm_booking.
create or replace function private.stage_allowed_in_phase(p_phase text, p_stage text) returns boolean
language sql immutable set search_path = '' as $$
  select p_stage in ('lost', 'unqualified') or case p_phase
    when 'lead_desk' then p_stage in ('new', 'contact_attempted', 'contacted')
    when 'qualification' then p_stage in ('interested', 'contact_attempted', 'contacted')
    when 'closing' then p_stage in ('qualified', 'quote_sent', 'negotiation', 'advance_pending')
    else false
  end
$$;

create or replace function private.desk_peek(p_desk text) returns uuid
language sql stable security definer set search_path = '' as $$
  with s as (select last_profile_id, last_joined_at from public.desk_rotation where desk = p_desk),
  members as (
    select p.id, p.created_at from public.profiles p
     where p.role = 'salesperson' and p.desk = p_desk and p.is_active and p.deleted_at is null and p.in_round_robin
  )
  select coalesce(
    (select m.id from members m, s
      where s.last_joined_at is null or (m.created_at, m.id) > (s.last_joined_at, s.last_profile_id)
      order by m.created_at, m.id limit 1),
    (select m.id from members m order by m.created_at, m.id limit 1))
$$;

create or replace function private.next_desk_owner(p_desk text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_next uuid;
begin
  insert into public.desk_rotation (desk) values (p_desk) on conflict (desk) do nothing;
  perform 1 from public.desk_rotation where desk = p_desk for update;
  v_next := private.desk_peek(p_desk);
  if v_next is not null then
    update public.desk_rotation r
       set last_profile_id = p.id, last_joined_at = p.created_at, updated_at = now()
      from public.profiles p
     where r.desk = p_desk and p.id = v_next;
  end if;
  return v_next;
end $$;

-- The existing round robin (new leads, imports, sheet sync) deals to the BDE 1 desk while the
-- pipeline is on, and to every salesperson as before while it's off.
create or replace function private.round_robin_peek() returns uuid
language sql stable security definer set search_path = '' as $$
  select case when private.pipeline_on() then private.desk_peek('lead_desk') else (
    with s as (select last_profile_id, last_joined_at from public.round_robin_state where id = 1),
    members as (
      select p.id, p.created_at from public.profiles p
       where p.role = 'salesperson' and p.is_active and p.deleted_at is null and p.in_round_robin
    )
    select coalesce(
      (select m.id from members m, s
        where s.last_joined_at is null or (m.created_at, m.id) > (s.last_joined_at, s.last_profile_id)
        order by m.created_at, m.id limit 1),
      (select m.id from members m order by m.created_at, m.id limit 1))
  ) end
$$;

create or replace function private.next_round_robin_owner() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_next uuid;
begin
  if private.pipeline_on() then
    return private.next_desk_owner('lead_desk');
  end if;
  perform 1 from public.round_robin_state where id = 1 for update;
  v_next := private.round_robin_peek();
  if v_next is not null then
    update public.round_robin_state s
       set last_profile_id = p.id, last_joined_at = p.created_at, updated_at = now()
      from public.profiles p
     where s.id = 1 and p.id = v_next;
  end if;
  return v_next;
end $$;

-- "Assign → Round robin": with the pipeline on, each lead goes to the next person on its own desk.
create or replace function public.assign_leads_round_robin(p_request_id uuid, p_lead_ids uuid[] default null, p_limit int default 500)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb := private.claim_request(p_request_id, 'assign_leads_round_robin');
  v_pipeline boolean := private.pipeline_on();
  v_lead public.leads;
  v_owner uuid;
  v_got jsonb := '{}'::jsonb;
  v_lost jsonb := '{}'::jsonb;
  v_key text;
  v_updated int := 0;
  v_nobody int := 0;
  v_actor_name text := private.staff_name(auth.uid());
  v_remaining int := 0;
  v_open text[] := array['new', 'contact_attempted', 'contacted', 'interested', 'qualified', 'quote_sent',
                         'negotiation', 'advance_pending'];
begin
  if v_replay is not null then return v_replay; end if;
  perform private.require_manager();
  if p_lead_ids is not null and coalesce(array_length(p_lead_ids, 1), 0) = 0 then
    raise exception using errcode = 'CR422', message = 'Select at least one lead.';
  end if;
  if coalesce(array_length(p_lead_ids, 1), 0) > 1000 then
    raise exception using errcode = 'CR422', message = 'Assign at most 1,000 leads at a time.';
  end if;
  if not v_pipeline and private.round_robin_peek() is null then
    raise exception using errcode = 'CR422', message = 'Nobody is in the round robin. Add salespeople, or include them on the Team page.';
  end if;

  for v_lead in
    select * from public.leads
     where case when p_lead_ids is null then owner_id is null and stage = any (v_open) else id = any (p_lead_ids) end
     order by acquired_at, lead_number
     limit case when p_lead_ids is null then greatest(1, least(coalesce(p_limit, 500), 1000)) else 1000 end
     for update
  loop
    v_owner := case when v_pipeline then private.next_desk_owner(v_lead.phase) else private.next_round_robin_owner() end;
    if v_owner is null then
      v_nobody := v_nobody + 1;
      continue;
    end if;
    if v_owner is not distinct from v_lead.owner_id then
      continue;
    end if;
    perform private.assign_lead_core(v_lead, v_owner, 'Round robin');
    v_updated := v_updated + 1;
    v_key := v_owner::text;
    v_got := jsonb_set(v_got, array[v_key], to_jsonb(coalesce((v_got->>v_key)::int, 0) + 1));
    if v_lead.owner_id is not null and v_lead.owner_id <> auth.uid() then
      v_key := v_lead.owner_id::text;
      v_lost := jsonb_set(v_lost, array[v_key], to_jsonb(coalesce((v_lost->>v_key)::int, 0) + 1));
    end if;
  end loop;

  if v_pipeline and v_updated = 0 and v_nobody > 0 then
    raise exception using errcode = 'CR422', message = 'Nobody is on the desk these leads are at. Add people to desks on the Team page.';
  end if;

  for v_key in select jsonb_object_keys(v_got) loop
    if v_key::uuid <> auth.uid() then
      perform private.notify(v_key::uuid, 'lead_assigned',
        case when (v_got->>v_key)::int = 1 then '1 lead assigned to you' else (v_got->>v_key) || ' leads assigned to you' end,
        'Round robin by ' || coalesce(v_actor_name, 'a manager'), '/leads?view=recently_assigned');
    end if;
  end loop;
  for v_key in select jsonb_object_keys(v_lost) loop
    perform private.notify(v_key::uuid, 'lead_reassigned_away',
      case when (v_lost->>v_key)::int = 1 then '1 lead was reassigned' else (v_lost->>v_key) || ' leads were reassigned' end,
      'Reassigned round robin by ' || coalesce(v_actor_name, 'a manager'), null);
  end loop;

  if p_lead_ids is null then
    select count(*)::int into v_remaining from public.leads where owner_id is null and stage = any (v_open);
  end if;
  perform private.audit('leads_round_robin', 'leads', null, jsonb_build_object('per_owner', v_got, 'updated', v_updated));

  return private.finish_request(p_request_id, jsonb_build_object(
    'updated', v_updated,
    'remaining', v_remaining,
    'skipped_no_one_on_desk', v_nobody,
    'per_owner', coalesce((
      select jsonb_agg(jsonb_build_object('id', k, 'name', private.staff_name(k::uuid), 'count', (v_got->>k)::int) order by private.staff_name(k::uuid))
        from jsonb_object_keys(v_got) k), '[]'::jsonb)));
end $$;

-- ---------------------------------------------------------------------------
-- Stage changes
-- ---------------------------------------------------------------------------
-- The unchanged stage-change body, plus: the stage_changed event records the desk, and while the
-- pipeline is off the desk follows the stage (so data is consistent when it's switched on).
create or replace function private.apply_stage_change_core(
  p_lead public.leads, p_stage text, p_reason text, p_pending_action text
) returns public.leads language plpgsql security definer set search_path = '' as $$
declare
  v_lead public.leads := p_lead;
  v_pending int;
  v_closing boolean := private.is_closed_stage(p_stage);
  v_was_closed boolean := private.is_closed_stage(p_lead.stage);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_fu record;
begin
  if not private.valid_stage(p_stage) then
    raise exception using errcode = 'CR422', message = 'Unknown stage.';
  end if;
  if p_stage = p_lead.stage then
    return p_lead;
  end if;
  if p_stage in ('lost', 'unqualified') and v_reason is null then
    raise exception using errcode = 'CR422', message = 'A reason is required for Lost or Unqualified.';
  end if;

  select count(*) into v_pending from public.follow_ups
  where lead_id = p_lead.id and status = 'pending';

  if v_closing and v_pending > 0 then
    if p_pending_action is null then
      raise exception using errcode = 'CR422',
        message = format('This lead has %s pending follow-up(s). Choose whether to cancel or complete them.', v_pending),
        hint = 'pending_follow_ups';
    end if;
    if p_stage in ('lost', 'unqualified') and p_pending_action not in ('cancel', 'complete') then
      raise exception using errcode = 'CR422', message = 'Pending follow-ups must be cancelled or completed when closing as lost or unqualified.';
    end if;
    if p_pending_action not in ('cancel', 'complete', 'keep') then
      raise exception using errcode = 'CR422', message = 'Invalid follow-up resolution.';
    end if;

    for v_fu in select id, purpose from public.follow_ups
                where lead_id = p_lead.id and status = 'pending' for update loop
      if p_pending_action = 'cancel' then
        update public.follow_ups
           set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
               cancel_reason = format('Lead marked %s%s', replace(p_stage, '_', ' '),
                                      coalesce(': ' || v_reason, '')),
               version = version + 1
         where id = v_fu.id;
        perform private.log_event(p_lead.id, 'follow_up_cancelled',
          jsonb_build_object('follow_up_id', v_fu.id, 'purpose', v_fu.purpose,
                             'reason', format('Lead closed as %s', replace(p_stage, '_', ' '))));
      elsif p_pending_action = 'complete' then
        update public.follow_ups
           set status = 'completed', completed_at = now(), completed_by = auth.uid(),
               outcome = format('Resolved when lead was marked %s', replace(p_stage, '_', ' ')),
               version = version + 1
         where id = v_fu.id;
        perform private.log_event(p_lead.id, 'follow_up_completed',
          jsonb_build_object('follow_up_id', v_fu.id, 'purpose', v_fu.purpose,
                             'outcome', 'Resolved on closing lead'));
      end if;
    end loop;
  end if;

  update public.leads
     set stage = p_stage,
         closed_reason = case when v_closing then v_reason else null end,
         closed_at = case when v_closing then now() else null end,
         phase = case when not private.pipeline_on() and private.phase_for_stage(p_stage) is not null
                      then private.phase_for_stage(p_stage) else phase end,
         last_activity_at = now(),
         version = version + 1
   where id = p_lead.id
  returning * into v_lead;

  perform private.log_event(p_lead.id, 'stage_changed', jsonb_build_object(
    'from', p_lead.stage, 'to', p_stage, 'reason', v_reason,
    'pending_follow_ups', v_pending, 'pending_action', p_pending_action, 'phase', p_lead.phase));

  if v_was_closed and not v_closing then
    perform private.log_event(p_lead.id, 'lead_reopened', jsonb_build_object(
      'from', p_lead.stage, 'to', p_stage, 'reason', v_reason));
  end if;
  return v_lead;
end $$;

-- Used by change_lead_stage and log_call. With the pipeline on, each desk can only set its own
-- stages; moving to the next desk is a handoff, and booked needs confirm_booking.
create or replace function private.apply_stage_change(
  p_lead public.leads, p_stage text, p_reason text, p_pending_action text
) returns public.leads language plpgsql security definer set search_path = '' as $$
begin
  if p_stage is distinct from p_lead.stage and private.pipeline_on() then
    if p_stage = 'booked' then
      raise exception using errcode = 'CR422',
        message = 'Use Confirm booking. A booking counts only once the advance payment is recorded.';
    end if;
    if not private.stage_allowed_in_phase(p_lead.phase, p_stage) then
      raise exception using errcode = 'CR422', message = format(
        'This lead is with %s, where it can''t be marked %s. Hand it on to the next desk instead.',
        private.phase_label(p_lead.phase), replace(p_stage, '_', ' '));
    end if;
  end if;
  return private.apply_stage_change_core(p_lead, p_stage, p_reason, p_pending_action);
end $$;

-- ---------------------------------------------------------------------------
-- Handoffs
-- ---------------------------------------------------------------------------
-- Records a desk move: owner, history, note, timeline, notification. The caller has locked the lead.
create or replace function private.move_to_desk(
  p_lead public.leads, p_from_phase text, p_to_phase text, p_owner uuid, p_note text
) returns public.leads language plpgsql security definer set search_path = '' as $$
declare
  v_lead public.leads;
begin
  update public.leads set phase = p_to_phase, last_activity_at = now() where id = p_lead.id;
  if p_owner is not null and p_owner is distinct from p_lead.owner_id then
    perform private.assign_lead_core(p_lead, p_owner, 'Handed to ' || private.phase_label(p_to_phase));
  end if;
  insert into public.lead_handoffs (lead_id, from_phase, to_phase, from_owner_id, to_owner_id, by_id, note)
  values (p_lead.id, p_from_phase, p_to_phase, p_lead.owner_id, coalesce(p_owner, p_lead.owner_id), auth.uid(), p_note);
  if p_note is not null then
    insert into public.lead_notes (lead_id, author_id, body) values (p_lead.id, auth.uid(), p_note);
  end if;
  perform private.log_event(p_lead.id, 'handed_off', jsonb_build_object(
    'from_phase', p_from_phase, 'to_phase', p_to_phase,
    'from_owner_id', p_lead.owner_id, 'from_name', private.staff_name(p_lead.owner_id),
    'to_owner_id', coalesce(p_owner, p_lead.owner_id), 'to_name', private.staff_name(coalesce(p_owner, p_lead.owner_id)),
    'note', left(p_note, 500)));
  if p_owner is not null and p_owner is distinct from auth.uid() then
    perform private.notify(p_owner, 'lead_assigned',
      'Lead handed to you: ' || p_lead.customer_name,
      'Now with ' || private.phase_label(p_to_phase) || ', from ' || coalesce(private.staff_name(auth.uid()), 'a teammate'),
      '/leads/' || p_lead.id, p_lead.id);
  end if;
  select * into v_lead from public.leads where id = p_lead.id;
  return v_lead;
end $$;

-- Push a lead to another desk. Salespeople push to the next desk only; managers to any desk.
-- → BDE 2 needs a connected call; → BDE 3 needs the event requirements; → BDE 4 is confirm_booking.
create or replace function public.handoff_lead(
  p_request_id uuid, p_lead_id uuid, p_expected_version int, p_to_phase text,
  p_note text, p_owner_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb := private.claim_request(p_request_id, 'handoff_lead');
  v_role text;
  v_lead public.leads;
  v_owner uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_stage text;
  v_from_phase text;
  v_missing text[] := '{}';
begin
  if v_replay is not null then return v_replay; end if;
  v_role := private.require_staff();
  if not private.pipeline_on() then
    raise exception using errcode = 'CR422', message = 'The BDE pipeline is switched off. An admin can turn it on from the Team page.';
  end if;
  v_lead := private.lock_lead_for_write(p_lead_id);
  perform private.check_version(v_lead.version, p_expected_version);

  if private.is_closed_stage(v_lead.stage) then
    raise exception using errcode = 'CR422', message = 'This lead is closed. Reopen it before handing it on.';
  end if;
  if p_to_phase not in ('lead_desk', 'qualification', 'closing') then
    raise exception using errcode = 'CR422', message = 'Leads reach BDE 4 by confirming the booking.';
  end if;
  if p_to_phase = v_lead.phase then
    raise exception using errcode = 'CR422', message = format('This lead is already with %s.', private.phase_label(p_to_phase));
  end if;
  if v_role = 'salesperson' and private.phase_rank(p_to_phase) <> private.phase_rank(v_lead.phase) + 1 then
    raise exception using errcode = 'CR403', message = 'You can only hand a lead on to the next desk.';
  end if;
  if v_note is null then
    raise exception using errcode = 'CR422', message = 'Add a note for the next desk: what the customer wants and what was agreed.';
  end if;
  if length(v_note) > 5000 then
    raise exception using errcode = 'CR422', message = 'Keep the note under 5,000 characters.';
  end if;

  if private.phase_rank(p_to_phase) > private.phase_rank(v_lead.phase) then
    if p_to_phase = 'qualification' and not exists (
      select 1 from public.call_logs where lead_id = v_lead.id and outcome = 'connected') then
      raise exception using errcode = 'CR422', message = 'Log a connected call before pushing the lead to BDE 2.';
    end if;
    if p_to_phase = 'closing' then
      if v_lead.occasion_code is null then v_missing := v_missing || 'event type'::text; end if;
      if v_lead.event_date is null then v_missing := v_missing || 'event date'::text; end if;
      if v_lead.event_address is null then v_missing := v_missing || 'location'::text; end if;
      if v_lead.guest_range is null then v_missing := v_missing || 'guest count'::text; end if;
      if v_lead.service_type is null then v_missing := v_missing || 'service'::text; end if;
      if v_lead.budget_inr is null then v_missing := v_missing || 'budget'::text; end if;
      if cardinality(v_missing) > 0 then
        raise exception using errcode = 'CR422', hint = 'missing_requirements',
          message = 'Fill in before qualifying: ' || array_to_string(v_missing, ', ') || '.';
      end if;
    end if;
  end if;

  if p_owner_id is not null then
    if v_role = 'salesperson' then
      raise exception using errcode = 'CR403', message = 'Only an admin or manager can choose who gets the lead.';
    end if;
    if not exists (select 1 from public.profiles where id = p_owner_id and is_active and deleted_at is null) then
      raise exception using errcode = 'CR422', message = 'The selected person is not an active team member.';
    end if;
    v_owner := p_owner_id;
  else
    v_owner := private.next_desk_owner(p_to_phase);
    if v_owner is null then
      raise exception using errcode = 'CR422',
        message = format('Nobody is on %s. Add someone to that desk on the Team page.', private.phase_label(p_to_phase));
    end if;
  end if;

  v_stage := case p_to_phase
    when 'qualification' then 'interested'
    when 'closing' then 'qualified'
    else case when v_lead.first_call_logged_at is null then 'new' else 'contacted' end end;
  v_from_phase := v_lead.phase;
  v_lead := private.apply_stage_change_core(v_lead, v_stage, null, null);
  v_lead := private.move_to_desk(v_lead, v_from_phase, p_to_phase, v_owner, v_note);

  return private.finish_request(p_request_id, jsonb_build_object(
    'version', v_lead.version, 'phase', v_lead.phase, 'stage', v_lead.stage,
    'owner_id', v_lead.owner_id, 'owner_name', private.staff_name(v_lead.owner_id)));
end $$;

-- ---------------------------------------------------------------------------
-- Payments and booking
-- ---------------------------------------------------------------------------
create or replace function private.lead_paid_total(p_lead_id uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case kind when 'refund' then -amount_inr else amount_inr end), 0)
    from public.lead_payments where lead_id = p_lead_id
$$;

create or replace function public.record_payment(
  p_request_id uuid, p_lead_id uuid, p_kind text, p_amount numeric, p_paid_on date,
  p_mode text default null, p_reference text default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb := private.claim_request(p_request_id, 'record_payment');
  v_lead public.leads;
  v_id uuid;
begin
  if v_replay is not null then return v_replay; end if;
  v_lead := private.lock_lead_for_write(p_lead_id);
  if p_kind not in ('advance', 'balance', 'refund') then
    raise exception using errcode = 'CR422', message = 'Choose advance, balance or refund.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount >= 1e10 then
    raise exception using errcode = 'CR422', message = 'Enter an amount above zero.';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Asia/Kolkata')::date then
    raise exception using errcode = 'CR422', message = 'Enter the date the money was received (not a future date).';
  end if;
  if p_mode is not null and p_mode not in ('upi', 'cash', 'bank_transfer', 'card', 'other') then
    raise exception using errcode = 'CR422', message = 'Unknown payment mode.';
  end if;
  if p_kind = 'refund' and p_amount > private.lead_paid_total(p_lead_id) then
    raise exception using errcode = 'CR422', message = 'A refund can''t be more than what has been paid.';
  end if;

  insert into public.lead_payments (lead_id, kind, amount_inr, paid_on, mode, reference, note, recorded_by)
  values (p_lead_id, p_kind, round(p_amount, 2), p_paid_on, p_mode,
          nullif(btrim(coalesce(p_reference, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  update public.leads set last_activity_at = now() where id = p_lead_id;
  perform private.log_event(p_lead_id, 'payment_recorded', jsonb_build_object(
    'payment_id', v_id, 'kind', p_kind, 'amount_inr', round(p_amount, 2), 'paid_on', p_paid_on, 'mode', p_mode));

  return private.finish_request(p_request_id, jsonb_build_object(
    'id', v_id, 'paid_total', private.lead_paid_total(p_lead_id)));
end $$;

-- Booking confirmed = quotation accepted + advance received + booking value recorded. The lead then
-- goes to BDE 4 (with the pipeline on). If nobody is on BDE 4 the booking still goes through and
-- stays with its owner, so a staffing gap never blocks a paying customer.
create or replace function public.confirm_booking(
  p_request_id uuid, p_lead_id uuid, p_expected_version int, p_booking_value numeric,
  p_pending_action text default null, p_owner_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb := private.claim_request(p_request_id, 'confirm_booking');
  v_role text;
  v_lead public.leads;
  v_owner uuid;
  v_from_phase text;
begin
  if v_replay is not null then return v_replay; end if;
  v_role := private.require_staff();
  v_lead := private.lock_lead_for_write(p_lead_id);
  perform private.check_version(v_lead.version, p_expected_version);
  v_from_phase := v_lead.phase;

  if private.is_closed_stage(v_lead.stage) then
    raise exception using errcode = 'CR422', message = 'This lead is closed. Reopen it before confirming a booking.';
  end if;
  if private.pipeline_on() and v_lead.phase <> 'closing' and v_role = 'salesperson' then
    raise exception using errcode = 'CR422', message = 'Bookings are confirmed by BDE 3 (closing).';
  end if;
  if p_booking_value is null or p_booking_value <= 0 or p_booking_value >= 1e10 then
    raise exception using errcode = 'CR422', message = 'Enter the booking value.';
  end if;
  if not exists (select 1 from public.lead_payments where lead_id = p_lead_id and kind = 'advance')
     or private.lead_paid_total(p_lead_id) <= 0 then
    raise exception using errcode = 'CR422', hint = 'advance_missing',
      message = 'Record the advance payment first. A booking counts only once the advance is received.';
  end if;

  update public.leads
     set booking_value_inr = round(p_booking_value, 2),
         quoted_amount_inr = coalesce(quoted_amount_inr, round(p_booking_value, 2))
   where id = p_lead_id
  returning * into v_lead;
  v_lead := private.apply_stage_change_core(v_lead, 'booked', null, p_pending_action);

  if p_owner_id is not null then
    if v_role = 'salesperson' then
      raise exception using errcode = 'CR403', message = 'Only an admin or manager can choose who gets the lead.';
    end if;
    if not exists (select 1 from public.profiles where id = p_owner_id and is_active and deleted_at is null) then
      raise exception using errcode = 'CR422', message = 'The selected person is not an active team member.';
    end if;
    v_owner := p_owner_id;
  elsif private.pipeline_on() then
    v_owner := private.next_desk_owner('operations');
  end if;
  v_lead := private.move_to_desk(v_lead, v_from_phase, 'operations', v_owner, null);

  return private.finish_request(p_request_id, jsonb_build_object(
    'version', v_lead.version, 'stage', v_lead.stage, 'phase', v_lead.phase,
    'owner_id', v_lead.owner_id, 'owner_name', private.staff_name(v_lead.owner_id),
    'handed_to_operations', v_owner is not null and v_owner is distinct from auth.uid()));
end $$;

-- BDE 4: acknowledge the handover, record the chef, mark the event completed. A cancelled booking
-- is marked Lost (reason "Booking cancelled") from Update stage, with any refund in the ledger.
create or replace function public.ops_update(
  p_request_id uuid, p_lead_id uuid, p_expected_version int, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb := private.claim_request(p_request_id, 'ops_update');
  v_lead public.leads;
  v_chef text := nullif(btrim(coalesce(p_payload->>'chef_name', '')), '');
  v_phone text := nullif(btrim(coalesce(p_payload->>'chef_phone', '')), '');
  v_notes text := nullif(btrim(coalesce(p_payload->>'ops_notes', '')), '');
  v_note text := nullif(btrim(coalesce(p_payload->>'note', '')), '');
begin
  if v_replay is not null then return v_replay; end if;
  v_lead := private.lock_lead_for_write(p_lead_id);
  perform private.check_version(v_lead.version, p_expected_version);
  if v_lead.stage <> 'booked' then
    raise exception using errcode = 'CR422', message = 'Only confirmed bookings can be handled by operations.';
  end if;

  if p_action = 'acknowledge' then
    if v_lead.handover_acknowledged_at is not null then
      raise exception using errcode = 'CR422', message = 'The handover is already acknowledged.';
    end if;
    update public.leads
       set handover_acknowledged_at = now(), handover_acknowledged_by = auth.uid(),
           last_activity_at = now(), version = version + 1
     where id = p_lead_id returning * into v_lead;
    perform private.log_event(p_lead_id, 'handover_acknowledged', '{}'::jsonb);
  elsif p_action = 'chef' then
    if v_chef is null then
      raise exception using errcode = 'CR422', message = 'Enter the chef''s name.';
    end if;
    if length(v_chef) > 120 or length(coalesce(v_phone, '')) > 40 or length(coalesce(v_notes, '')) > 2000 then
      raise exception using errcode = 'CR422', message = 'Some details are too long.';
    end if;
    update public.leads
       set chef_name = v_chef, chef_phone = v_phone, ops_notes = v_notes,
           chef_assigned_at = coalesce(chef_assigned_at, now()),
           handover_acknowledged_at = coalesce(handover_acknowledged_at, now()),
           handover_acknowledged_by = coalesce(handover_acknowledged_by, auth.uid()),
           last_activity_at = now(), version = version + 1
     where id = p_lead_id returning * into v_lead;
    perform private.log_event(p_lead_id, 'chef_assigned', jsonb_build_object(
      'chef_name', v_chef, 'chef_phone', v_phone, 'changed', v_lead.chef_assigned_at < now()));
  elsif p_action = 'complete' then
    if v_lead.event_completed_at is not null then
      raise exception using errcode = 'CR422', message = 'The event is already marked completed.';
    end if;
    if v_lead.chef_name is null then
      raise exception using errcode = 'CR422', message = 'Assign the chef before marking the event completed.';
    end if;
    update public.leads
       set event_completed_at = now(), last_activity_at = now(), version = version + 1
     where id = p_lead_id returning * into v_lead;
    if v_note is not null then
      insert into public.lead_notes (lead_id, author_id, body) values (p_lead_id, auth.uid(), v_note);
    end if;
    perform private.log_event(p_lead_id, 'event_completed', jsonb_build_object('note', left(v_note, 500)));
  else
    raise exception using errcode = 'CR422', message = 'Unknown operations action.';
  end if;

  return private.finish_request(p_request_id, jsonb_build_object('version', v_lead.version));
end $$;

-- ---------------------------------------------------------------------------
-- Lead details: + service_type, budget_inr (same signature)
-- ---------------------------------------------------------------------------
create or replace function public.update_lead_details(
  p_request_id uuid, p_lead_id uuid, p_expected_version int, p_patch jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb := private.claim_request(p_request_id, 'update_lead_details');
  v_old public.leads;
  v_new public.leads;
  v_old_json jsonb;
  v_new_json jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_allowed text[] := array['customer_name', 'phone_e164', 'phone_raw', 'occasion_code', 'menu_code',
    'guest_range', 'event_date', 'event_address', 'priority', 'quoted_amount_inr', 'booking_value_inr',
    'service_type', 'budget_inr'];
begin
  if v_replay is not null then return v_replay; end if;
  v_old := private.lock_lead_for_write(p_lead_id);
  perform private.check_version(v_old.version, p_expected_version);

  for v_key in select jsonb_object_keys(p_patch) loop
    if not v_key = any (v_allowed) then
      raise exception using errcode = 'CR422', message = format('Field %s cannot be edited here.', v_key);
    end if;
  end loop;
  if p_patch ? 'priority' and p_patch->>'priority' not in ('low', 'normal', 'high') then
    raise exception using errcode = 'CR422', message = 'Invalid priority.';
  end if;
  if p_patch ? 'service_type' and nullif(p_patch->>'service_type', '') is not null
     and p_patch->>'service_type' not in ('chef_on_demand', 'catering') then
    raise exception using errcode = 'CR422', message = 'Choose Chef on Demand or Catering.';
  end if;

  update public.leads l set
    customer_name = case when p_patch ? 'customer_name' then btrim(p_patch->>'customer_name') else l.customer_name end,
    phone_e164 = case when p_patch ? 'phone_e164' then p_patch->>'phone_e164' else l.phone_e164 end,
    phone_raw = case when p_patch ? 'phone_raw' then nullif(p_patch->>'phone_raw', '') else l.phone_raw end,
    occasion_code = case when p_patch ? 'occasion_code' then nullif(p_patch->>'occasion_code', '') else l.occasion_code end,
    menu_code = case when p_patch ? 'menu_code' then nullif(p_patch->>'menu_code', '') else l.menu_code end,
    guest_range = case when p_patch ? 'guest_range' then nullif(p_patch->>'guest_range', '') else l.guest_range end,
    event_date = case when p_patch ? 'event_date' then nullif(p_patch->>'event_date', '')::date else l.event_date end,
    event_date_status = case when p_patch ? 'event_date' then
        case when nullif(p_patch->>'event_date', '') is null then
          case when l.event_date_status = 'needs_review' and l.event_date is null then 'needs_review' else 'missing' end
        else 'confirmed' end
      else l.event_date_status end,
    review_flags = case when p_patch ? 'event_date' and nullif(p_patch->>'event_date', '') is not null
      then array_remove(array_remove(l.review_flags, 'date_needs_review'), 'event_details_missing')
      else l.review_flags end,
    event_address = case when p_patch ? 'event_address' then nullif(btrim(p_patch->>'event_address'), '') else l.event_address end,
    priority = case when p_patch ? 'priority' then p_patch->>'priority' else l.priority end,
    quoted_amount_inr = case when p_patch ? 'quoted_amount_inr' then nullif(p_patch->>'quoted_amount_inr', '')::numeric else l.quoted_amount_inr end,
    booking_value_inr = case when p_patch ? 'booking_value_inr' then nullif(p_patch->>'booking_value_inr', '')::numeric else l.booking_value_inr end,
    service_type = case when p_patch ? 'service_type' then nullif(p_patch->>'service_type', '') else l.service_type end,
    budget_inr = case when p_patch ? 'budget_inr' then nullif(p_patch->>'budget_inr', '')::numeric else l.budget_inr end,
    version = l.version + 1,
    last_activity_at = now()
  where l.id = p_lead_id
  returning * into v_new;

  v_old_json := to_jsonb(v_old);
  v_new_json := to_jsonb(v_new);
  foreach v_key in array v_allowed loop
    if v_old_json->v_key is distinct from v_new_json->v_key then
      v_changes := v_changes || jsonb_build_object(v_key,
        jsonb_build_object('from', v_old_json->v_key, 'to', v_new_json->v_key));
    end if;
  end loop;
  if v_changes <> '{}'::jsonb then
    perform private.log_event(p_lead_id, 'details_updated', jsonb_build_object('changes', v_changes));
  end if;

  return private.finish_request(p_request_id, jsonb_build_object('version', v_new.version, 'changed', v_changes <> '{}'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Admin: desks and the switch. Managers: monthly targets.
-- ---------------------------------------------------------------------------
-- p_desks: {"<profile id>": "lead_desk" | "qualification" | "closing" | "operations" | null}
create or replace function public.update_pipeline(p_enabled boolean, p_desks jsonb default '{}'::jsonb, p_sla_minutes int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_desk text;
  v_missing text[];
begin
  perform private.require_admin();
  for v_key, v_desk in select key, nullif(value #>> '{}', '') from jsonb_each(coalesce(p_desks, '{}'::jsonb)) loop
    if v_desk is not null and v_desk not in ('lead_desk', 'qualification', 'closing', 'operations') then
      raise exception using errcode = 'CR422', message = 'Unknown desk.';
    end if;
    if v_desk is not null and not exists (
      select 1 from public.profiles where id = v_key::uuid and role = 'salesperson' and deleted_at is null) then
      raise exception using errcode = 'CR422', message = 'Only salespeople can be put on a desk.';
    end if;
    update public.profiles set desk = v_desk where id = v_key::uuid and desk is distinct from v_desk;
  end loop;

  if coalesce(p_enabled, false) then
    select array_agg(private.phase_label(d)) into v_missing
      from unnest(array['lead_desk', 'qualification', 'closing', 'operations']) d
     where private.desk_peek(d) is null;
    if v_missing is not null then
      raise exception using errcode = 'CR422',
        message = 'Put at least one active salesperson on every desk first. Missing: ' || array_to_string(v_missing, ', ') || '.';
    end if;
  end if;
  if p_sla_minutes is not null and (p_sla_minutes < 1 or p_sla_minutes > 1440) then
    raise exception using errcode = 'CR422', message = 'The first-call target must be between 1 and 1,440 minutes.';
  end if;

  update public.business_settings
     set pipeline_enabled = coalesce(p_enabled, false),
         first_call_sla_minutes = coalesce(p_sla_minutes, first_call_sla_minutes),
         updated_by = auth.uid(), updated_at = now()
   where id = 1;
  perform private.audit('pipeline_updated', 'business_settings', '1', jsonb_build_object(
    'enabled', coalesce(p_enabled, false), 'desks', coalesce(p_desks, '{}'::jsonb), 'sla_minutes', p_sla_minutes));
  return jsonb_build_object('enabled', coalesce(p_enabled, false), 'next', jsonb_build_object(
    'lead_desk', private.desk_peek('lead_desk'), 'qualification', private.desk_peek('qualification'),
    'closing', private.desk_peek('closing'), 'operations', private.desk_peek('operations')));
end $$;

-- Who gets the next lead on each desk (for the Team page).
create or replace function public.desk_next()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_manager();
  return jsonb_build_object(
    'lead_desk', private.desk_peek('lead_desk'), 'qualification', private.desk_peek('qualification'),
    'closing', private.desk_peek('closing'), 'operations', private.desk_peek('operations'));
end $$;

create or replace function public.upsert_sales_target(p_month date, p_values jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.sales_targets;
  v_key text;
begin
  perform private.require_manager();
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception using errcode = 'CR422', message = 'Choose a month.';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_values, '{}'::jsonb)) loop
    if v_key not in ('leads_per_day', 'working_days', 'push_rate', 'qualification_rate', 'closing_rate',
                     'chef_ticket_inr', 'catering_ticket_inr', 'chef_mix_pct') then
      raise exception using errcode = 'CR422', message = format('Target %s cannot be set.', v_key);
    end if;
  end loop;
  insert into public.sales_targets (month, updated_by) values (p_month, auth.uid()) on conflict (month) do nothing;
  update public.sales_targets t set
    leads_per_day = coalesce((p_values->>'leads_per_day')::int, t.leads_per_day),
    working_days = coalesce((p_values->>'working_days')::int, t.working_days),
    push_rate = coalesce((p_values->>'push_rate')::numeric, t.push_rate),
    qualification_rate = coalesce((p_values->>'qualification_rate')::numeric, t.qualification_rate),
    closing_rate = coalesce((p_values->>'closing_rate')::numeric, t.closing_rate),
    chef_ticket_inr = coalesce((p_values->>'chef_ticket_inr')::numeric, t.chef_ticket_inr),
    catering_ticket_inr = coalesce((p_values->>'catering_ticket_inr')::numeric, t.catering_ticket_inr),
    chef_mix_pct = coalesce((p_values->>'chef_mix_pct')::numeric, t.chef_mix_pct),
    updated_by = auth.uid(), updated_at = now()
  where t.month = p_month returning * into v_row;
  perform private.audit('sales_target_updated', 'sales_targets', p_month::text, to_jsonb(v_row));
  return to_jsonb(v_row);
end $$;

-- ---------------------------------------------------------------------------
-- KPIs: desk flows for an IST date range (one day = the daily report). Managers see the whole team;
-- a salesperson sees only their own numbers. Raw counts only; rates and scores are computed in the
-- app (src/lib/domain/targets.ts) so they're unit-tested in one place.
--
--   desks/people: {desk, metric, leads} where metric is
--     received  lead desk: leads created in range (by first owner); other desks: handed in
--     attended  lead desk: of those received, first call logged
--     within_sla lead desk: first call within first_call_sla_minutes of the first assignment
--     pushed    handed forward to the next desk in range
--     lost      closed lost/unqualified at that desk in range
--     acknowledged / chef_assigned  operations: of those received, handover acknowledged / chef set
--     completed operations: events completed in range
--     open      right now: open leads at the desk (operations: bookings not yet completed)
-- ---------------------------------------------------------------------------
create or replace function public.pipeline_kpis(p_from text, p_to text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.require_staff();
  v_person uuid := case when v_role in ('admin', 'manager') then null else auth.uid() end;
  v_from timestamptz := private.ist_day_start(p_from);
  v_to timestamptz := private.ist_day_end(p_to);
  v_sla int := coalesce((select first_call_sla_minutes from public.business_settings where id = 1), 15);
  v_flows jsonb;
  v_result jsonb;
begin
  if v_from is null or v_to is null or v_to <= v_from then
    raise exception using errcode = 'CR422', message = 'Choose a date range.';
  end if;
  if v_to - v_from > interval '400 days' then
    raise exception using errcode = 'CR422', message = 'Choose a range of at most 400 days.';
  end if;

  with
  h as (select * from public.lead_handoffs where created_at >= v_from and created_at < v_to),
  created as (
    select l.id, l.first_call_logged_at, fa.new_owner_id as first_owner,
           coalesce(fa.created_at, l.created_at) as first_assigned_at
      from public.leads l
      left join lateral (
        select ah.new_owner_id, ah.created_at from public.assignment_history ah
         where ah.lead_id = l.id and ah.new_owner_id is not null
         order by ah.created_at, ah.id limit 1) fa on true
     where l.created_at >= v_from and l.created_at < v_to
  ),
  lost as (
    select e.lead_id, e.actor_id, e.payload->>'phase' as phase
      from public.lead_events e
     where e.event_type = 'stage_changed' and e.payload->>'to' in ('lost', 'unqualified')
       and e.payload ? 'phase' and e.created_at >= v_from and e.created_at < v_to
  ),
  in_ops as (select distinct lead_id from public.lead_handoffs where to_phase = 'operations'),
  facts as (
    select first_owner as person, 'lead_desk'::text as desk, 'received'::text as metric, id as lead_id from created
    union all select first_owner, 'lead_desk', 'attended', id from created where first_call_logged_at is not null
    union all select first_owner, 'lead_desk', 'within_sla', id from created
      where first_call_logged_at <= first_assigned_at + make_interval(mins => v_sla)
    union all select to_owner_id, to_phase, 'received', lead_id from h
    union all select from_owner_id, from_phase, 'pushed', lead_id from h
      where private.phase_rank(to_phase) > private.phase_rank(from_phase)
    union all select actor_id, phase, 'lost', lead_id from lost
    union all select h.to_owner_id, 'operations', 'acknowledged', h.lead_id
      from h join public.leads l on l.id = h.lead_id
     where h.to_phase = 'operations' and l.handover_acknowledged_at is not null
    union all select h.to_owner_id, 'operations', 'chef_assigned', h.lead_id
      from h join public.leads l on l.id = h.lead_id
     where h.to_phase = 'operations' and l.chef_name is not null
    union all select l.owner_id, 'operations', 'completed', l.id from public.leads l
     where l.event_completed_at >= v_from and l.event_completed_at < v_to
    union all select l.owner_id, l.phase, 'open', l.id from public.leads l
     where l.stage not in ('booked', 'lost', 'unqualified')
    union all select l.owner_id, 'operations', 'open', l.id from public.leads l
     where l.stage = 'booked' and l.event_completed_at is null and l.id in (select lead_id from in_ops)
  ),
  mine as (select * from facts where v_person is null or person = v_person)
  select jsonb_build_object(
    'desks', coalesce((select jsonb_agg(jsonb_build_object('desk', desk, 'metric', metric, 'leads', n))
                         from (select desk, metric, count(distinct lead_id) n from mine group by desk, metric) d), '[]'),
    'people', coalesce((select jsonb_agg(jsonb_build_object('person_id', person, 'desk', desk, 'metric', metric, 'leads', n))
                          from (select person, desk, metric, count(distinct lead_id) n from mine
                                 where person is not null group by person, desk, metric) p), '[]'),
    'loss_reasons', coalesce((select jsonb_agg(jsonb_build_object('desk', desk, 'reason', reason, 'leads', n) order by n desc)
                          from (select e.payload->>'phase' desk, coalesce(e.payload->>'reason', '') reason, count(distinct e.lead_id) n
                                  from public.lead_events e
                                 where e.event_type = 'stage_changed' and e.payload->>'to' in ('lost', 'unqualified')
                                   and e.payload ? 'phase' and e.created_at >= v_from and e.created_at < v_to
                                   and (v_person is null or e.actor_id = v_person)
                                 group by 1, 2) r), '[]')
  ) into v_flows;

  select v_flows || jsonb_build_object(
    'calls', (select jsonb_build_object(
                'attempted', count(*), 'connected', count(*) filter (where outcome = 'connected'),
                'leads', count(distinct lead_id))
                from public.call_logs
               where called_at >= v_from and called_at < v_to and (v_person is null or caller_id = v_person)),
    'quotes', (select jsonb_build_object('sent', count(*), 'value', coalesce(sum(l.quoted_amount_inr), 0))
                 from public.leads l
                where exists (select 1 from public.lead_events e
                               where e.lead_id = l.id and e.event_type = 'stage_changed' and e.payload->>'to' = 'quote_sent'
                                 and e.created_at >= v_from and e.created_at < v_to
                                 and (v_person is null or e.actor_id = v_person))),
    'follow_ups', jsonb_build_object(
       'due', (select count(*) from public.follow_ups where due_at >= v_from and due_at < v_to and status <> 'cancelled'
                 and (v_person is null or assignee_id = v_person)),
       'completed', (select count(*) from public.follow_ups where status = 'completed' and completed_at >= v_from
                       and completed_at < v_to and (v_person is null or completed_by = v_person)),
       'overdue_now', (select count(*) from public.follow_ups where status = 'pending' and due_at < now()
                         and (v_person is null or assignee_id = v_person))),
    'bookings', (select jsonb_build_object(
                   'count', count(*), 'gross', coalesce(sum(l.booking_value_inr), 0),
                   'by_service', coalesce((select jsonb_agg(jsonb_build_object('service', s, 'count', c, 'gross', g))
                     from (select coalesce(l2.service_type, '') s, count(*) c, coalesce(sum(l2.booking_value_inr), 0) g
                             from (select distinct lead_id, from_owner_id from public.lead_handoffs
                                    where to_phase = 'operations' and created_at >= v_from and created_at < v_to
                                      and (v_person is null or from_owner_id = v_person)) b2
                             join public.leads l2 on l2.id = b2.lead_id group by 1) x), '[]'))
                   from (select distinct lead_id from public.lead_handoffs
                          where to_phase = 'operations' and created_at >= v_from and created_at < v_to
                            and (v_person is null or from_owner_id = v_person)) b
                   join public.leads l on l.id = b.lead_id),
    'payments', (select jsonb_build_object(
                   'advance', coalesce(sum(amount_inr) filter (where kind = 'advance'), 0),
                   'balance', coalesce(sum(amount_inr) filter (where kind = 'balance'), 0),
                   'refund', coalesce(sum(amount_inr) filter (where kind = 'refund'), 0))
                   from public.lead_payments
                  where paid_on >= p_from::date and paid_on <= p_to::date
                    and (v_person is null or recorded_by = v_person)),
    'realized', (select coalesce(sum(booking_value_inr), 0) from public.leads
                  where event_completed_at >= v_from and event_completed_at < v_to
                    and (v_person is null or owner_id = v_person)),
    'outstanding', (select coalesce(sum(greatest(l.booking_value_inr - private.lead_paid_total(l.id), 0)), 0)
                      from public.leads l
                     where l.stage = 'booked' and l.booking_value_inr is not null
                       and exists (select 1 from public.lead_payments p where p.lead_id = l.id)
                       and (v_person is null or l.owner_id = v_person)),
    'hygiene', jsonb_build_object(
       'no_next_action', (select count(*) from public.leads where stage not in ('booked', 'lost', 'unqualified')
                            and next_follow_up_at is null and (v_person is null or owner_id = v_person)),
       'unassigned', (select count(*) from public.leads where stage not in ('booked', 'lost', 'unqualified')
                        and owner_id is null and v_person is null),
       'sla_breaches', (select count(*) from public.leads where stage not in ('booked', 'lost', 'unqualified')
                          and phase = 'lead_desk' and first_call_logged_at is null and owner_id is not null
                          and coalesce(assigned_at, created_at) < now() - make_interval(mins => v_sla)
                          and (v_person is null or owner_id = v_person)),
       'awaiting_handover', (select count(*) from public.leads l where l.stage = 'booked'
                               and l.handover_acknowledged_at is null and l.id in (select lead_id from public.lead_handoffs where to_phase = 'operations')
                               and (v_person is null or l.owner_id = v_person))),
    'sla_minutes', v_sla,
    'scope', case when v_person is null then 'team' else 'me' end,
    'generated_at', now()
  ) into v_result;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- search_leads: + phase[], service_type[], no_next_action (same signature)
-- ---------------------------------------------------------------------------
create or replace function public.search_leads(p_filters jsonb default '{}'::jsonb)
returns setof public.leads
language sql stable security invoker set search_path = '' as $$
  with f as (
    select
      nullif(btrim(p_filters->>'q'), '') as q,
      regexp_replace(coalesce(p_filters->>'q', ''), '\D', '', 'g') as q_digits,
      private.jsonb_text_array(p_filters->'owner') as owners,
      private.jsonb_text_array(p_filters->'stage') as stages,
      nullif(p_filters->>'stage_group', '') as stage_group,
      private.jsonb_text_array(p_filters->'platform') as platforms,
      private.jsonb_text_array(p_filters->'campaign') as campaigns,
      private.jsonb_text_array(p_filters->'ad') as ads,
      private.jsonb_text_array(p_filters->'occasion') as occasions,
      private.jsonb_text_array(p_filters->'menu') as menus,
      private.jsonb_text_array(p_filters->'priority') as priorities,
      private.jsonb_text_array(p_filters->'event_status') as event_statuses,
      private.jsonb_text_array(p_filters->'ids') as ids,
      private.jsonb_text_array(p_filters->'phase') as phases,
      private.jsonb_text_array(p_filters->'service_type') as service_types,
      coalesce((p_filters->>'no_next_action')::boolean, false) as no_next_action,
      nullif(p_filters->>'event_from', '')::date as event_from,
      nullif(p_filters->>'event_to', '')::date as event_to,
      private.ist_day_start(p_filters->>'acquired_from') as acquired_from,
      private.ist_day_end(p_filters->>'acquired_to') as acquired_to,
      private.ist_day_start(p_filters->>'imported_from') as imported_from,
      private.ist_day_end(p_filters->>'imported_to') as imported_to,
      private.ist_day_start(p_filters->>'closed_from') as closed_from,
      private.ist_day_end(p_filters->>'closed_to') as closed_to,
      nullif(p_filters->>'follow_up', '') as follow_up,
      coalesce((p_filters->>'review')::boolean, false) as review,
      coalesce((p_filters->>'no_contact')::boolean, false) as no_contact,
      nullif(p_filters->>'import_batch', '') as import_batch,
      nullif(p_filters->>'assigned_since', '')::timestamptz as assigned_since,
      nullif(p_filters->>'phone', '') as phone,
      nullif(p_filters->>'source', '') as source,
      p_filters->'activity' as activity,
      ((now() at time zone 'Asia/Kolkata')::date + 1)::timestamp at time zone 'Asia/Kolkata' as today_end
  )
  select l.*
  from public.leads l, f
  where (f.q is null
         or l.customer_name ilike private.like_pattern(f.q)
         or (length(f.q_digits) >= 4 and l.phone_e164 like '%' || f.q_digits || '%')
         or l.lead_number::text = regexp_replace(f.q, '^[Ll]-?', '')
         or l.external_lead_id ilike private.like_pattern(f.q)
         or l.campaign_name ilike private.like_pattern(f.q))
    and (f.owners is null or exists (
          select 1 from unnest(f.owners) o(v)
          where (o.v = 'unassigned' and l.owner_id is null)
             or (o.v = 'me' and l.owner_id = auth.uid())
             or l.owner_id::text = o.v))
    and (f.stages is null or l.stage = any (f.stages))
    and (f.stage_group is null
         or (f.stage_group = 'open' and l.stage not in ('booked', 'lost', 'unqualified'))
         or (f.stage_group = 'closed' and l.stage in ('booked', 'lost', 'unqualified')))
    and (f.platforms is null or coalesce(l.platform, '') = any (f.platforms))
    and (f.campaigns is null or coalesce(l.campaign_name, '') = any (f.campaigns))
    and (f.ads is null or coalesce(l.ad_name, '') = any (f.ads))
    and (f.occasions is null or coalesce(l.occasion_code, '') = any (f.occasions))
    and (f.menus is null or coalesce(l.menu_code, '') = any (f.menus))
    and (f.priorities is null or l.priority = any (f.priorities))
    and (f.event_statuses is null or l.event_date_status = any (f.event_statuses))
    and (f.ids is null or l.id::text = any (f.ids))
    and (f.phases is null or l.phase = any (f.phases))
    and (f.service_types is null or coalesce(l.service_type, '') = any (f.service_types))
    and (not f.no_next_action or (l.next_follow_up_at is null and l.stage not in ('booked', 'lost', 'unqualified')))
    and (f.event_from is null or l.event_date >= f.event_from)
    and (f.event_to is null or l.event_date <= f.event_to)
    and (f.acquired_from is null or l.acquired_at >= f.acquired_from)
    and (f.acquired_to is null or l.acquired_at < f.acquired_to)
    and (f.imported_from is null or l.created_at >= f.imported_from)
    and (f.imported_to is null or l.created_at < f.imported_to)
    and (f.closed_from is null or l.closed_at >= f.closed_from)
    and (f.closed_to is null or l.closed_at < f.closed_to)
    and (f.follow_up is null
         or (f.follow_up = 'overdue' and l.next_follow_up_at < now())
         or (f.follow_up = 'today' and l.next_follow_up_at >= now() and l.next_follow_up_at < f.today_end)
         or (f.follow_up = 'due' and l.next_follow_up_at < f.today_end)
         or (f.follow_up = 'upcoming' and l.next_follow_up_at >= f.today_end)
         or (f.follow_up = 'none' and l.next_follow_up_at is null))
    and (not f.review or cardinality(l.review_flags) > 0)
    and (not f.no_contact or (l.first_call_logged_at is null and l.stage not in ('booked', 'lost', 'unqualified')))
    and (f.import_batch is null or l.import_batch_id::text = f.import_batch)
    and (f.assigned_since is null or l.assigned_at >= f.assigned_since)
    and (f.phone is null or l.phone_e164 = f.phone)
    and (f.source is null or l.source_system = f.source)
    and (f.activity is null or (
      case f.activity->>'type'
        when 'call' then exists (
          select 1 from public.call_logs c
          where c.lead_id = l.id
            and (nullif(f.activity->>'outcome', '') is null or c.outcome = f.activity->>'outcome')
            and (private.ist_day_start(f.activity->>'from') is null or c.called_at >= private.ist_day_start(f.activity->>'from'))
            and (private.ist_day_end(f.activity->>'to') is null or c.called_at < private.ist_day_end(f.activity->>'to'))
            and (nullif(f.activity->>'actor', '') is null or c.caller_id::text = f.activity->>'actor'))
        when 'dial' then exists (
          select 1 from public.lead_events e
          where e.lead_id = l.id and e.event_type = 'dial_requested'
            and (private.ist_day_start(f.activity->>'from') is null or e.created_at >= private.ist_day_start(f.activity->>'from'))
            and (private.ist_day_end(f.activity->>'to') is null or e.created_at < private.ist_day_end(f.activity->>'to'))
            and (nullif(f.activity->>'actor', '') is null or e.actor_id::text = f.activity->>'actor'))
        when 'follow_up_completed' then exists (
          select 1 from public.follow_ups fu
          where fu.lead_id = l.id and fu.status = 'completed'
            and (private.ist_day_start(f.activity->>'from') is null or fu.completed_at >= private.ist_day_start(f.activity->>'from'))
            and (private.ist_day_end(f.activity->>'to') is null or fu.completed_at < private.ist_day_end(f.activity->>'to'))
            and (nullif(f.activity->>'actor', '') is null or fu.completed_by::text = f.activity->>'actor'))
        when 'booked' then exists (
          select 1 from public.lead_events e
          where e.lead_id = l.id and e.event_type = 'stage_changed' and e.payload->>'to' = 'booked'
            and (private.ist_day_start(f.activity->>'from') is null or e.created_at >= private.ist_day_start(f.activity->>'from'))
            and (private.ist_day_end(f.activity->>'to') is null or e.created_at < private.ist_day_end(f.activity->>'to'))
            and (nullif(f.activity->>'actor', '') is null or e.actor_id::text = f.activity->>'actor'))
        else true
      end))
$$;

-- ---------------------------------------------------------------------------
-- Service (Chef on Demand / Catering) from the sheet tab, form or campaign name, for imported and
-- synced leads. Set once on insert, never overwritten; existing leads are filled in the same way.
-- ---------------------------------------------------------------------------
create or replace function private.service_from_text(p_text text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_text ~* '\mchef' and p_text !~* '\mcater' then 'chef_on_demand'
    when p_text ~* '\mcater' and p_text !~* '\mchef' then 'catering'
  end
$$;

create or replace function private.default_service_type() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.service_type is null then
    new.service_type := coalesce(
      private.service_from_text((select b.sheet_name from public.import_batches b where b.id = new.import_batch_id)),
      private.service_from_text(concat_ws(' ', new.form_name, new.campaign_name, new.adset_name, new.ad_name)));
  end if;
  return new;
end $$;
create trigger leads_default_service before insert on public.leads
  for each row execute function private.default_service_type();

alter table public.leads disable trigger leads_touch;
update public.leads l
   set service_type = coalesce(
     private.service_from_text((select b.sheet_name from public.import_batches b where b.id = l.import_batch_id)),
     private.service_from_text(concat_ws(' ', l.form_name, l.campaign_name, l.adset_name, l.ad_name)))
 where l.service_type is null;
alter table public.leads enable trigger leads_touch;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function
  private.merge_reasons(text[], text[]), private.service_from_text(text), private.default_service_type(), private.pipeline_on(), private.phase_rank(text), private.phase_label(text),
  private.phase_for_stage(text), private.stage_allowed_in_phase(text, text), private.desk_peek(text),
  private.next_desk_owner(text), private.apply_stage_change_core(public.leads, text, text, text),
  private.move_to_desk(public.leads, text, text, uuid, text), private.lead_paid_total(uuid)
from public, anon, authenticated;
revoke all on function
  public.handoff_lead(uuid, uuid, int, text, text, uuid),
  public.record_payment(uuid, uuid, text, numeric, date, text, text, text),
  public.confirm_booking(uuid, uuid, int, numeric, text, uuid),
  public.ops_update(uuid, uuid, int, text, jsonb),
  public.update_pipeline(boolean, jsonb, int), public.desk_next(),
  public.upsert_sales_target(date, jsonb), public.pipeline_kpis(text, text)
from public, anon;
grant execute on function
  public.handoff_lead(uuid, uuid, int, text, text, uuid),
  public.record_payment(uuid, uuid, text, numeric, date, text, text, text),
  public.confirm_booking(uuid, uuid, int, numeric, text, uuid),
  public.ops_update(uuid, uuid, int, text, jsonb),
  public.update_pipeline(boolean, jsonb, int), public.desk_next(),
  public.upsert_sales_target(date, jsonb), public.pipeline_kpis(text, text)
to authenticated;
