-- Round robin: new leads go to the salespeople in turn. The rotation follows the order people
-- joined and remembers whose turn is next, so someone added later simply takes their turn from then
-- on (they don't "catch up" on leads the others got before). Admins switch it on or off and leave
-- people out (e.g. on leave) on the Team page; managers can also deal out leads already waiting.
--
-- Used by: Google Sheet sync (when on), imports and new leads when "Round robin" is chosen, and the
-- "Assign → Round robin" bulk action.

alter table public.business_settings add column round_robin_enabled boolean not null default true;
alter table public.profiles add column in_round_robin boolean not null default true;
alter table public.import_batches add column assign_round_robin boolean not null default false;

comment on column public.profiles.in_round_robin is 'Salespeople only: false leaves them out of the round robin (e.g. on leave).';

-- Whose turn was last, by their place in the rotation (joined time, then id). Kept as values so the
-- rotation carries on correctly if that person later leaves.
create table public.round_robin_state (
  id smallint primary key default 1 check (id = 1),
  last_profile_id uuid,
  last_joined_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.round_robin_state (id) values (1) on conflict (id) do nothing;
alter table public.round_robin_state enable row level security;

-- The person whose turn is next, without taking the turn.
create or replace function private.round_robin_peek() returns uuid
language sql stable security definer set search_path = '' as $$
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
$$;

-- Takes the next turn: returns that salesperson and moves the rotation on. Null when nobody is in it.
create or replace function private.next_round_robin_owner() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_next uuid;
begin
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

create or replace function public.round_robin_next() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_manager();
  return private.round_robin_peek();
end $$;

-- On/off, and who is left out. Only salespeople take part.
create or replace function public.update_round_robin(p_enabled boolean, p_excluded uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  update public.business_settings set round_robin_enabled = coalesce(p_enabled, false), updated_by = auth.uid(), updated_at = now()
   where id = 1;
  update public.profiles
     set in_round_robin = not (id = any (coalesce(p_excluded, '{}')))
   where role = 'salesperson' and in_round_robin is distinct from not (id = any (coalesce(p_excluded, '{}')));
  perform private.audit('round_robin_updated', 'business_settings', '1',
    jsonb_build_object('enabled', coalesce(p_enabled, false), 'excluded', to_jsonb(coalesce(p_excluded, '{}'))));
  return jsonb_build_object('enabled', coalesce(p_enabled, false), 'next', private.round_robin_peek());
end $$;

-- Moves one lead to a new owner, as assign_leads does: pending follow-ups move with it, and the
-- history and timeline record who, when and why. Returns how many follow-ups moved.
create or replace function private.assign_lead_core(p_lead public.leads, p_owner uuid, p_reason text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_moved int;
begin
  update public.leads
     set owner_id = p_owner, assigned_at = case when p_owner is null then null else now() end, version = version + 1
   where id = p_lead.id;
  update public.follow_ups
     set assignee_id = p_owner, version = version + 1
   where lead_id = p_lead.id and status = 'pending';
  get diagnostics v_moved = row_count;
  insert into public.assignment_history
    (lead_id, previous_owner_id, new_owner_id, assigned_by, reason, transferred_follow_ups)
  values (p_lead.id, p_lead.owner_id, p_owner, auth.uid(), p_reason, v_moved);
  perform private.log_event(p_lead.id, case when p_owner is null then 'unassigned' else 'assigned' end,
    jsonb_build_object(
      'from_owner_id', p_lead.owner_id, 'from_name', private.staff_name(p_lead.owner_id),
      'to_owner_id', p_owner, 'to_name', private.staff_name(p_owner),
      'reason', p_reason, 'transferred_follow_ups', v_moved));
  return v_moved;
end $$;

-- Deals leads out round robin. With p_lead_ids: those leads (≤ 1,000). Without: open leads that
-- have no owner, oldest enquiry first, at most p_limit per call — the result says how many are left,
-- so the caller repeats until none remain. One notification per person per call.
create or replace function public.assign_leads_round_robin(p_request_id uuid, p_lead_ids uuid[] default null, p_limit int default 500)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb := private.claim_request(p_request_id, 'assign_leads_round_robin');
  v_lead public.leads;
  v_owner uuid;
  v_got jsonb := '{}'::jsonb;
  v_lost jsonb := '{}'::jsonb;
  v_key text;
  v_updated int := 0;
  v_actor_name text := private.staff_name(auth.uid());
  v_remaining int := 0;
  v_open text[] := array['new', 'contact_attempted', 'contacted', 'qualified', 'quote_sent', 'negotiation'];
begin
  if v_replay is not null then return v_replay; end if;
  perform private.require_manager();
  if p_lead_ids is not null and coalesce(array_length(p_lead_ids, 1), 0) = 0 then
    raise exception using errcode = 'CR422', message = 'Select at least one lead.';
  end if;
  if coalesce(array_length(p_lead_ids, 1), 0) > 1000 then
    raise exception using errcode = 'CR422', message = 'Assign at most 1,000 leads at a time.';
  end if;
  if private.round_robin_peek() is null then
    raise exception using errcode = 'CR422', message = 'Nobody is in the round robin. Add salespeople, or include them on the Team page.';
  end if;

  for v_lead in
    select * from public.leads
     where case when p_lead_ids is null then owner_id is null and stage = any (v_open) else id = any (p_lead_ids) end
     order by acquired_at, lead_number
     limit case when p_lead_ids is null then greatest(1, least(coalesce(p_limit, 500), 1000)) else 1000 end
     for update
  loop
    v_owner := private.next_round_robin_owner();
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
    'per_owner', coalesce((
      select jsonb_agg(jsonb_build_object('id', k, 'name', private.staff_name(k::uuid), 'count', (v_got->>k)::int) order by private.staff_name(k::uuid))
        from jsonb_object_keys(v_got) k), '[]'::jsonb)));
end $$;

-- New lead form: "Round robin" as the owner (p_lead.assign = 'round_robin').
create or replace function public.create_lead(p_request_id uuid, p_lead jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb := private.claim_request(p_request_id, 'create_lead');
  v_owner uuid := nullif(p_lead->>'owner_id', '')::uuid;
  v_event_date date := nullif(p_lead->>'event_date', '')::date;
  v_lead public.leads;
  v_note text := nullif(btrim(coalesce(p_lead->>'note', '')), '');
begin
  if v_replay is not null then return v_replay; end if;
  perform private.require_manager();

  if v_owner is not null and not exists (select 1 from public.profiles where id = v_owner and is_active) then
    raise exception using errcode = 'CR422', message = 'The selected owner is not an active team member.';
  end if;
  if v_owner is null and coalesce(p_lead->>'assign', '') = 'round_robin' then
    v_owner := private.next_round_robin_owner();
    if v_owner is null then
      raise exception using errcode = 'CR422', message = 'Nobody is in the round robin. Choose an owner instead.';
    end if;
  end if;

  insert into public.leads (
    customer_name, phone_e164, phone_raw, occasion_code, menu_code, guest_range,
    event_date, event_date_status, event_address, priority, owner_id, assigned_at,
    quoted_amount_inr, platform, source_system, created_by, last_activity_at
  ) values (
    btrim(p_lead->>'customer_name'), p_lead->>'phone_e164', nullif(p_lead->>'phone_raw', ''),
    nullif(p_lead->>'occasion_code', ''), nullif(p_lead->>'menu_code', ''), nullif(p_lead->>'guest_range', ''),
    v_event_date, case when v_event_date is null then 'missing' else 'confirmed' end,
    nullif(btrim(coalesce(p_lead->>'event_address', '')), ''),
    coalesce(nullif(p_lead->>'priority', ''), 'normal'), v_owner,
    case when v_owner is not null then now() end,
    nullif(p_lead->>'quoted_amount_inr', '')::numeric, nullif(p_lead->>'platform', ''),
    'manual', auth.uid(), now()
  ) returning * into v_lead;

  perform private.log_event(v_lead.id, 'lead_created', jsonb_build_object('source', 'manual'));

  if v_owner is not null then
    insert into public.assignment_history (lead_id, previous_owner_id, new_owner_id, assigned_by, reason)
    values (v_lead.id, null, v_owner, auth.uid(),
            case when p_lead->>'assign' = 'round_robin' then 'Round robin at creation' else 'Assigned at creation' end);
    perform private.log_event(v_lead.id, 'assigned', jsonb_build_object(
      'from_owner_id', null, 'to_owner_id', v_owner, 'to_name', private.staff_name(v_owner)));
    if v_owner <> auth.uid() then
      perform private.notify(v_owner, 'lead_assigned', 'New lead assigned: ' || v_lead.customer_name,
        'Assigned by ' || coalesce(private.staff_name(auth.uid()), 'a manager'),
        '/leads/' || v_lead.id, v_lead.id);
    end if;
  end if;

  if v_note is not null then
    insert into public.lead_notes (lead_id, author_id, body) values (v_lead.id, auth.uid(), v_note);
    perform private.log_event(v_lead.id, 'note_added', jsonb_build_object('excerpt', left(v_note, 280)));
  end if;

  return private.finish_request(p_request_id,
    jsonb_build_object('id', v_lead.id, 'lead_number', v_lead.lead_number));
end $$;

-- Imports: a batch can deal its new leads out round robin (import_batches.assign_round_robin).
create or replace function private.import_create_batch_core(p_actor uuid, p_origin text, p_client_token uuid, p_meta jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.import_batches;
  v_owner uuid := nullif(p_meta->>'default_owner_id', '')::uuid;
  v_total int := coalesce((p_meta->>'total_rows')::int, 0);
begin
  if v_total < 1 then
    raise exception using errcode = 'CR422', message = 'The file has no data rows to import.';
  end if;
  if v_total > 1000 then
    raise exception using errcode = 'CR422',
      message = format('This file has %s data rows. The limit is 1,000 per import — split the file and import each part.', v_total);
  end if;
  if v_owner is not null and not exists (select 1 from public.profiles where id = v_owner and is_active) then
    raise exception using errcode = 'CR422', message = 'The selected owner is not active.';
  end if;

  insert into public.import_batches (
    client_token, file_name, file_size, file_sha256, sheet_name, column_mapping,
    event_year_choice, default_owner_id, uploaded_by, total_rows, origin, assign_round_robin
  ) values (
    p_client_token, left(coalesce(p_meta->>'file_name', 'upload'), 255), (p_meta->>'file_size')::bigint,
    p_meta->>'file_sha256', p_meta->>'sheet_name', coalesce(p_meta->'column_mapping', '{}'::jsonb),
    p_meta->'event_year_choice', v_owner, p_actor, v_total, p_origin,
    v_owner is null and coalesce(p_meta->>'assign', '') = 'round_robin'
  )
  on conflict (client_token) do nothing
  returning * into v_batch;

  if v_batch.id is null then
    select * into v_batch from public.import_batches where client_token = p_client_token;
    return to_jsonb(v_batch) || jsonb_build_object('existing', true);
  end if;
  return to_jsonb(v_batch) || jsonb_build_object('existing', false);
end $$;

create or replace function private.import_process_rows_core(p_actor uuid, p_batch_id uuid, p_limit int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.import_batches;
  v_row public.import_rows;
  n jsonb;
  v_lead_id uuid;
  v_existing uuid;
  v_owner uuid;
  v_processed int := 0;
  v_row_owner uuid;
  v_flags text[];
  v_assigned record;
begin
  select * into v_batch from public.import_batches where id = p_batch_id;
  if not found then
    raise exception using errcode = 'CR404', message = 'Import not found.';
  end if;
  if v_batch.status = 'staging' then
    raise exception using errcode = 'CR409', message = 'This import is still being prepared. Upload the remaining rows first.';
  end if;
  if v_batch.status = 'cancelled' then
    raise exception using errcode = 'CR409', message = 'This import was cancelled.';
  end if;
  v_owner := v_batch.default_owner_id;
  if v_owner is not null and not exists (select 1 from public.profiles where id = v_owner and is_active) then
    v_owner := null;
  end if;

  if v_batch.status in ('completed', 'completed_with_issues')
     and not exists (select 1 from public.import_rows where batch_id = p_batch_id and status = 'pending') then
    -- Nothing left to do (e.g. a retried request after completion).
    return jsonb_build_object(
      'status', v_batch.status, 'total', v_batch.total_rows, 'processed_now', 0,
      'created', v_batch.created_count, 'skipped', v_batch.skipped_count,
      'invalid', v_batch.invalid_count, 'failed', v_batch.failed_count,
      'pending', 0, 'warnings', v_batch.warning_count);
  end if;

  update public.import_batches
     set status = 'processing', started_at = coalesce(started_at, now()), last_heartbeat_at = now()
   where id = p_batch_id;

  for v_row in
    select * from public.import_rows
    where batch_id = p_batch_id and status = 'pending'
    order by row_number
    limit greatest(1, least(coalesce(p_limit, 100), 250))
    for update skip locked
  loop
    v_processed := v_processed + 1;
    if v_row.decision = 'skip' then
      update public.import_rows
         set status = 'skipped', skip_reason = coalesce(skip_reason, 'skipped_by_reviewer'), processed_at = now()
       where id = v_row.id;
      continue;
    end if;

    begin
      n := v_row.normalized;
      v_flags := array(select jsonb_array_elements_text(coalesce(n->'review_flags', '[]'::jsonb)));
      v_lead_id := null;

      insert into public.leads (
        customer_name, phone_e164, phone_raw, occasion_code, menu_code, guest_range,
        event_date, event_date_raw, event_date_status, event_address, stage,
        owner_id, assigned_at, source_system, external_lead_id, external_lead_id_raw,
        external_id_damaged, source_fingerprint, source_created_at,
        ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, form_id, form_name,
        is_organic, platform, source_status, legacy_crm_update, source_raw, review_flags,
        import_batch_id, import_row_number, created_by
      ) values (
        n->>'customer_name', n->>'phone_e164', n->>'phone_raw', n->>'occasion_code', n->>'menu_code', n->>'guest_range',
        nullif(n->>'event_date', '')::date, n->>'event_date_raw', coalesce(n->>'event_date_status', 'missing'),
        n->>'event_address', 'new',
        v_owner, case when v_owner is not null then now() end,
        'meta_lead_ads', nullif(n->>'external_lead_id', ''), n->>'external_lead_id_raw',
        coalesce((n->>'external_id_damaged')::boolean, false), nullif(n->>'source_fingerprint', ''),
        nullif(n->>'source_created_at', '')::timestamptz,
        n->>'ad_id', n->>'ad_name', n->>'adset_id', n->>'adset_name', n->>'campaign_id', n->>'campaign_name',
        n->>'form_id', n->>'form_name', (n->>'is_organic')::boolean, n->>'platform', n->>'source_status',
        n->>'legacy_crm_update', v_row.raw, v_flags,
        p_batch_id, v_row.row_number, p_actor
      )
      on conflict do nothing
      returning id into v_lead_id;

      if v_lead_id is null then
        select l.id into v_existing from public.leads l
        where (nullif(n->>'external_lead_id', '') is not null
               and l.source_system = 'meta_lead_ads' and l.external_lead_id = n->>'external_lead_id')
           or (nullif(n->>'source_fingerprint', '') is not null and l.source_fingerprint = n->>'source_fingerprint')
        limit 1;
        update public.import_rows
           set status = 'skipped', skip_reason = 'exact_duplicate', lead_id = v_existing,
               processed_at = now(), error_message = null
         where id = v_row.id;
      else
        insert into public.lead_events (lead_id, actor_id, event_type, payload)
        values (v_lead_id, p_actor, 'lead_imported', jsonb_build_object(
          'batch_id', p_batch_id, 'file_name', v_batch.file_name, 'row_number', v_row.row_number,
          'review_flags', to_jsonb(v_flags),
          'kept_as_separate_enquiry_of', v_row.warnings));
        -- Round robin takes a turn only for a lead actually created (never for a skipped duplicate).
        v_row_owner := v_owner;
        if v_row_owner is null and v_batch.assign_round_robin then
          v_row_owner := private.next_round_robin_owner();
          if v_row_owner is not null then
            update public.leads set owner_id = v_row_owner, assigned_at = now() where id = v_lead_id;
          end if;
        end if;
        if v_row_owner is not null then
          insert into public.assignment_history (lead_id, previous_owner_id, new_owner_id, assigned_by, reason)
          values (v_lead_id, null, v_row_owner, p_actor,
                  case when v_owner is null then 'Round robin during import' else 'Assigned during import' end);
          insert into public.lead_events (lead_id, actor_id, event_type, payload)
          values (v_lead_id, p_actor, 'assigned', jsonb_build_object(
            'from_owner_id', null, 'to_owner_id', v_row_owner, 'to_name', private.staff_name(v_row_owner),
            'reason', case when v_owner is null then 'Round robin during import' else 'Assigned during import' end));
        end if;
        update public.import_rows
           set status = 'created', lead_id = v_lead_id, processed_at = now(), error_message = null
         where id = v_row.id;
      end if;
    exception when others then
      update public.import_rows
         set status = 'failed', error_message = left(sqlerrm, 500), processed_at = now()
       where id = v_row.id;
    end;
  end loop;

  v_batch := private.refresh_import_counts(p_batch_id);

  if v_batch.pending_count = 0 and v_batch.status = 'processing' then
    update public.import_batches
       set status = case when failed_count > 0 then 'completed_with_issues' else 'completed' end,
           finished_at = now(), completion_runs = completion_runs + 1
     where id = p_batch_id
    returning * into v_batch;

    -- Sheet sync runs every 10 minutes; its status shows in the top bar instead.
    if v_batch.origin <> 'sheet_sync' then
      perform private.notify(v_batch.uploaded_by, 'import_completed',
        format('Import finished: %s', private.import_label(v_batch.file_name, v_batch.sheet_name)),
        format('%s created · %s skipped · %s invalid · %s failed',
               v_batch.created_count, v_batch.skipped_count, v_batch.invalid_count, v_batch.failed_count),
        '/imports/' || p_batch_id, null, null, p_batch_id,
        'import_done:' || p_batch_id || ':' || v_batch.completion_runs);
    end if;

    -- One notification per person who received leads from this batch (the chosen owner, or each
    -- salesperson the round robin gave leads to).
    for v_assigned in
      select l.owner_id, count(*)::int as n
        from public.leads l
       where l.import_batch_id = p_batch_id and l.owner_id is not null and l.owner_id <> v_batch.uploaded_by
       group by l.owner_id
    loop
      perform private.notify(v_assigned.owner_id, 'lead_assigned',
        case when v_assigned.n = 1 then 'New lead assigned to you' else format('%s new leads assigned to you', v_assigned.n) end,
        'From ' || case when v_batch.origin = 'sheet_sync' then 'Google Sheet sync · ' || coalesce(btrim(v_batch.sheet_name), 'sheet')
                        else 'import ' || private.import_label(v_batch.file_name, v_batch.sheet_name) end,
        '/leads?import=' || p_batch_id, null, null, p_batch_id,
        'import_assigned:' || p_batch_id || ':' || v_assigned.owner_id || ':' || v_batch.completion_runs);
    end loop;
  end if;

  return jsonb_build_object(
    'status', v_batch.status, 'total', v_batch.total_rows, 'processed_now', v_processed,
    'created', v_batch.created_count, 'skipped', v_batch.skipped_count,
    'invalid', v_batch.invalid_count, 'failed', v_batch.failed_count,
    'pending', v_batch.pending_count, 'warnings', v_batch.warning_count);
end $$;

create or replace function public.sheet_sync_stage(p_token uuid, p_client_token uuid, p_meta jsonb, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sync public.sheet_sync := private.sheet_sync_require_run(p_token);
  v_batch jsonb;
begin
  -- Synced leads go round robin when it's on (Team page).
  v_batch := private.import_create_batch_core(v_sync.actor_id, 'sheet_sync', p_client_token,
    p_meta || jsonb_build_object('assign',
      case when (select round_robin_enabled from public.business_settings where id = 1) then 'round_robin' end));
  if v_batch->>'origin' <> 'sheet_sync' then
    raise exception using errcode = 'CR409', message = 'That import is not a sheet sync batch.';
  end if;
  return jsonb_build_object('batch_id', v_batch->>'id')
    || private.import_stage_rows_core((v_batch->>'id')::uuid, p_rows);
end $$;

revoke all on function
  private.round_robin_peek(), private.next_round_robin_owner(), private.assign_lead_core(public.leads, uuid, text)
from public, anon, authenticated;
revoke all on function
  public.round_robin_next(), public.update_round_robin(boolean, uuid[]), public.assign_leads_round_robin(uuid, uuid[], int)
from public, anon;
grant execute on function
  public.round_robin_next(), public.update_round_robin(boolean, uuid[]), public.assign_leads_round_robin(uuid, uuid[], int)
to authenticated;
