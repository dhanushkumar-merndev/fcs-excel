-- Lead workflows. Every function: SECURITY DEFINER, empty search_path, explicit permission
-- checks, business change + audit event in one transaction, optimistic version checks,
-- and request-id idempotency where the client submits a form.

create or replace function private.is_closed_stage(p_stage text) returns boolean
language sql immutable set search_path = '' as $$
  select p_stage in ('booked', 'lost', 'unqualified')
$$;

create or replace function private.valid_stage(p_stage text) returns boolean
language sql immutable set search_path = '' as $$
  select p_stage in ('new', 'contact_attempted', 'contacted', 'qualified', 'quote_sent',
                     'negotiation', 'booked', 'lost', 'unqualified')
$$;

create or replace function private.notify(
  p_recipient uuid, p_type text, p_title text, p_body text, p_link text,
  p_lead uuid default null, p_follow_up uuid default null, p_batch uuid default null,
  p_dedupe text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_recipient is null then
    return;
  end if;
  insert into public.notifications
    (recipient_id, type, title, body, link, lead_id, follow_up_id, import_batch_id, dedupe_key)
  values (p_recipient, p_type, p_title, p_body, p_link, p_lead, p_follow_up, p_batch, p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;

create or replace function private.ist_label(p_ts timestamptz) returns text
language sql stable set search_path = '' as $$
  select to_char(p_ts at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')
$$;

-- ---------------------------------------------------------------------------
-- Stage change core (shared by change_lead_stage and log_call)
-- ---------------------------------------------------------------------------
create or replace function private.apply_stage_change(
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
         last_activity_at = now(),
         version = version + 1
   where id = p_lead.id
  returning * into v_lead;

  perform private.log_event(p_lead.id, 'stage_changed', jsonb_build_object(
    'from', p_lead.stage, 'to', p_stage, 'reason', v_reason,
    'pending_follow_ups', v_pending, 'pending_action', p_pending_action));

  if v_was_closed and not v_closing then
    perform private.log_event(p_lead.id, 'lead_reopened', jsonb_build_object(
      'from', p_lead.stage, 'to', p_stage, 'reason', v_reason));
  end if;
  return v_lead;
end $$;

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------
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
    values (v_lead.id, null, v_owner, auth.uid(), 'Assigned at creation');
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
    'guest_range', 'event_date', 'event_address', 'priority', 'quoted_amount_inr', 'booking_value_inr'];
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

create or replace function public.change_lead_stage(
  p_request_id uuid, p_lead_id uuid, p_expected_version int, p_stage text,
  p_reason text default null, p_pending_action text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb := private.claim_request(p_request_id, 'change_lead_stage');
  v_lead public.leads;
begin
  if v_replay is not null then return v_replay; end if;
  v_lead := private.lock_lead_for_write(p_lead_id);
  perform private.check_version(v_lead.version, p_expected_version);
  v_lead := private.apply_stage_change(v_lead, p_stage, p_reason, p_pending_action);
  return private.finish_request(p_request_id, jsonb_build_object('version', v_lead.version, 'stage', v_lead.stage));
end $$;

create or replace function public.assign_leads(
  p_request_id uuid, p_lead_ids uuid[], p_owner_id uuid, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb := private.claim_request(p_request_id, 'assign_leads');
  v_lead public.leads;
  v_moved int;
  v_count int := 0;
  v_unchanged int := 0;
  v_first uuid;
  v_first_name text;
  v_prev_counts jsonb := '{}'::jsonb;
  v_prev text;
  v_actor_name text := private.staff_name(auth.uid());
begin
  if v_replay is not null then return v_replay; end if;
  perform private.require_manager();
  if coalesce(array_length(p_lead_ids, 1), 0) = 0 then
    raise exception using errcode = 'CR422', message = 'Select at least one lead.';
  end if;
  if array_length(p_lead_ids, 1) > 1000 then
    raise exception using errcode = 'CR422', message = 'Assign at most 1,000 leads at a time.';
  end if;
  if p_owner_id is not null and not exists (select 1 from public.profiles where id = p_owner_id and is_active) then
    raise exception using errcode = 'CR422', message = 'The selected salesperson is not active.';
  end if;

  for v_lead in select * from public.leads where id = any (p_lead_ids) order by id for update loop
    if v_lead.owner_id is not distinct from p_owner_id then
      v_unchanged := v_unchanged + 1;
      continue;
    end if;

    update public.leads
       set owner_id = p_owner_id,
           assigned_at = case when p_owner_id is null then null else now() end,
           version = version + 1
     where id = v_lead.id;

    -- Pending work moves with the lead; completed work keeps its original attribution.
    update public.follow_ups
       set assignee_id = p_owner_id, version = version + 1
     where lead_id = v_lead.id and status = 'pending';
    get diagnostics v_moved = row_count;

    insert into public.assignment_history
      (lead_id, previous_owner_id, new_owner_id, assigned_by, reason, transferred_follow_ups)
    values (v_lead.id, v_lead.owner_id, p_owner_id, auth.uid(), nullif(btrim(coalesce(p_reason, '')), ''), v_moved);

    perform private.log_event(v_lead.id, case when p_owner_id is null then 'unassigned' else 'assigned' end,
      jsonb_build_object(
        'from_owner_id', v_lead.owner_id, 'from_name', private.staff_name(v_lead.owner_id),
        'to_owner_id', p_owner_id, 'to_name', private.staff_name(p_owner_id),
        'reason', nullif(btrim(coalesce(p_reason, '')), ''), 'transferred_follow_ups', v_moved));

    if v_lead.owner_id is not null and v_lead.owner_id <> auth.uid() then
      v_prev := v_lead.owner_id::text;
      v_prev_counts := jsonb_set(v_prev_counts, array[v_prev], to_jsonb(coalesce((v_prev_counts->>v_prev)::int, 0) + 1));
    end if;

    v_count := v_count + 1;
    if v_first is null then
      v_first := v_lead.id;
      v_first_name := v_lead.customer_name;
    end if;
  end loop;

  if p_owner_id is not null and v_count > 0 and p_owner_id <> auth.uid() then
    if v_count = 1 then
      perform private.notify(p_owner_id, 'lead_assigned', 'New lead assigned: ' || v_first_name,
        'Assigned by ' || coalesce(v_actor_name, 'a manager'), '/leads/' || v_first, v_first);
    else
      perform private.notify(p_owner_id, 'lead_assigned', v_count || ' leads assigned to you',
        'Assigned by ' || coalesce(v_actor_name, 'a manager'), '/leads?view=recently_assigned');
    end if;
  end if;

  for v_prev in select jsonb_object_keys(v_prev_counts) loop
    perform private.notify(v_prev::uuid, 'lead_reassigned_away',
      case when (v_prev_counts->>v_prev)::int = 1 then '1 lead was reassigned'
           else (v_prev_counts->>v_prev) || ' leads were reassigned' end,
      'Reassigned by ' || coalesce(v_actor_name, 'a manager') ||
        coalesce(' to ' || private.staff_name(p_owner_id), ' to the unassigned queue'),
      null);
  end loop;

  return private.finish_request(p_request_id,
    jsonb_build_object('updated', v_count, 'unchanged', v_unchanged,
                       'not_found', array_length(p_lead_ids, 1) - v_count - v_unchanged));
end $$;

-- Tapping Call records intent only. It never creates a call log or implies an answered call.
create or replace function public.log_dial_action(p_lead_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_lead public.leads := private.lock_lead_for_write(p_lead_id);
begin
  if exists (
    select 1 from public.lead_events
    where lead_id = p_lead_id and actor_id = auth.uid() and event_type = 'dial_requested'
      and created_at > now() - interval '10 seconds'
  ) then
    return jsonb_build_object('recorded', false);
  end if;
  perform private.log_event(p_lead_id, 'dial_requested', jsonb_build_object('phone', v_lead.phone_e164));
  update public.leads set first_dial_at = coalesce(first_dial_at, now()) where id = p_lead_id;
  return jsonb_build_object('recorded', true);
end $$;

create or replace function private.insert_follow_up(
  p_lead public.leads, p_due_at timestamptz, p_purpose text, p_assignee uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_purpose text := nullif(btrim(coalesce(p_purpose, '')), '');
begin
  if p_due_at is null then
    raise exception using errcode = 'CR422', message = 'Choose when to follow up.';
  end if;
  if p_due_at < now() - interval '5 minutes' then
    raise exception using errcode = 'CR422', message = 'Follow-up time is in the past.';
  end if;
  if v_purpose is null then
    raise exception using errcode = 'CR422', message = 'Add a short purpose for the follow-up.';
  end if;
  insert into public.follow_ups (lead_id, assignee_id, created_by, due_at, purpose)
  values (p_lead.id, p_assignee, auth.uid(), p_due_at, v_purpose)
  returning id into v_id;
  perform private.log_event(p_lead.id, 'follow_up_created', jsonb_build_object(
    'follow_up_id', v_id, 'due_at', p_due_at, 'purpose', v_purpose,
    'assignee_id', p_assignee, 'assignee_name', private.staff_name(p_assignee)));
  return v_id;
end $$;

create or replace function public.log_call(
  p_request_id uuid, p_lead_id uuid, p_outcome text, p_note text default null,
  p_follow_up jsonb default null, p_new_stage text default null,
  p_complete_follow_up_id uuid default null, p_expected_version int default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb := private.claim_request(p_request_id, 'log_call');
  v_lead public.leads;
  v_call uuid;
  v_note_id uuid;
  v_fu uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_replay is not null then return v_replay; end if;
  v_lead := private.lock_lead_for_write(p_lead_id);
  perform private.check_version(v_lead.version, p_expected_version);
  if p_outcome not in ('connected', 'no_answer', 'busy', 'switched_off', 'wrong_number', 'callback_requested') then
    raise exception using errcode = 'CR422', message = 'Choose a call outcome.';
  end if;

  insert into public.call_logs (lead_id, caller_id, outcome) values (p_lead_id, auth.uid(), p_outcome)
  returning id into v_call;

  if v_note is not null then
    insert into public.lead_notes (lead_id, author_id, body, call_log_id)
    values (p_lead_id, auth.uid(), v_note, v_call) returning id into v_note_id;
  end if;

  perform private.log_event(p_lead_id, 'call_logged', jsonb_build_object(
    'call_log_id', v_call, 'outcome', p_outcome, 'note_id', v_note_id, 'note', left(v_note, 500)));

  update public.leads
     set first_call_logged_at = coalesce(first_call_logged_at, now()),
         last_activity_at = now(), version = version + 1
   where id = p_lead_id
  returning * into v_lead;

  if p_complete_follow_up_id is not null then
    update public.follow_ups
       set status = 'completed', completed_at = now(), completed_by = auth.uid(),
           outcome = 'Call: ' || replace(p_outcome, '_', ' ') || coalesce(' — ' || left(v_note, 200), ''),
           version = version + 1
     where id = p_complete_follow_up_id and lead_id = p_lead_id and status = 'pending';
    if found then
      perform private.log_event(p_lead_id, 'follow_up_completed', jsonb_build_object(
        'follow_up_id', p_complete_follow_up_id, 'outcome', 'Call logged: ' || replace(p_outcome, '_', ' ')));
    end if;
  end if;

  if p_follow_up is not null and p_follow_up <> 'null'::jsonb then
    v_fu := private.insert_follow_up(v_lead, (p_follow_up->>'due_at')::timestamptz,
      p_follow_up->>'purpose', coalesce(v_lead.owner_id, auth.uid()));
  end if;

  if p_new_stage is not null and p_new_stage <> v_lead.stage then
    if private.is_closed_stage(p_new_stage) then
      raise exception using errcode = 'CR422', message = 'Use Update stage to close a lead.';
    end if;
    v_lead := private.apply_stage_change(v_lead, p_new_stage, null, null);
  end if;

  return private.finish_request(p_request_id, jsonb_build_object(
    'call_log_id', v_call, 'note_id', v_note_id, 'follow_up_id', v_fu,
    'stage', v_lead.stage, 'version', v_lead.version));
end $$;

create or replace function public.add_note(p_request_id uuid, p_lead_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb := private.claim_request(p_request_id, 'add_note');
  v_id uuid;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if v_replay is not null then return v_replay; end if;
  perform private.lock_lead_for_write(p_lead_id);
  if v_body is null then
    raise exception using errcode = 'CR422', message = 'Write a note first.';
  end if;
  insert into public.lead_notes (lead_id, author_id, body) values (p_lead_id, auth.uid(), v_body)
  returning id into v_id;
  update public.leads set last_activity_at = now() where id = p_lead_id;
  perform private.log_event(p_lead_id, 'note_added', jsonb_build_object('note_id', v_id, 'excerpt', left(v_body, 280)));
  return private.finish_request(p_request_id, jsonb_build_object('id', v_id));
end $$;

create or replace function public.edit_note(p_request_id uuid, p_note_id uuid, p_expected_version int, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb := private.claim_request(p_request_id, 'edit_note');
  v_note public.lead_notes;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if v_replay is not null then return v_replay; end if;
  perform private.require_staff();
  select * into v_note from public.lead_notes where id = p_note_id for update;
  if not found or not private.can_access_lead(v_note.lead_id) then
    raise exception using errcode = 'CR404', message = 'Note not found.';
  end if;
  if v_note.author_id <> auth.uid() then
    raise exception using errcode = 'CR403', message = 'Only the author can edit a note.';
  end if;
  perform private.check_version(v_note.version, p_expected_version);
  if v_body is null then
    raise exception using errcode = 'CR422', message = 'A note cannot be empty.';
  end if;
  if v_body = v_note.body then
    return private.finish_request(p_request_id, jsonb_build_object('version', v_note.version));
  end if;

  insert into public.lead_note_revisions (note_id, lead_id, revision, body, edited_by)
  values (v_note.id, v_note.lead_id, v_note.version, v_note.body, auth.uid());
  update public.lead_notes set body = v_body, edited_at = now(), version = version + 1
  where id = v_note.id returning * into v_note;
  perform private.log_event(v_note.lead_id, 'note_edited', jsonb_build_object(
    'note_id', v_note.id, 'revision', v_note.version, 'excerpt', left(v_body, 280)));
  return private.finish_request(p_request_id, jsonb_build_object('version', v_note.version));
end $$;

create or replace function public.create_follow_up(
  p_request_id uuid, p_lead_id uuid, p_due_at timestamptz, p_purpose text, p_assignee_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb := private.claim_request(p_request_id, 'create_follow_up');
  v_role text := private.require_staff();
  v_lead public.leads;
  v_assignee uuid;
  v_id uuid;
begin
  if v_replay is not null then return v_replay; end if;
  v_lead := private.lock_lead_for_write(p_lead_id);
  if p_assignee_id is not null and v_role = 'salesperson' and p_assignee_id <> auth.uid() then
    raise exception using errcode = 'CR403', message = 'Salespeople can only schedule their own follow-ups.';
  end if;
  v_assignee := coalesce(p_assignee_id, v_lead.owner_id, auth.uid());
  if not exists (select 1 from public.profiles where id = v_assignee and is_active) then
    raise exception using errcode = 'CR422', message = 'The responsible person is not active.';
  end if;
  v_id := private.insert_follow_up(v_lead, p_due_at, p_purpose, v_assignee);
  update public.leads set last_activity_at = now() where id = p_lead_id;
  return private.finish_request(p_request_id, jsonb_build_object('id', v_id));
end $$;

create or replace function private.lock_follow_up_for_write(p_id uuid, p_expected_version int)
returns public.follow_ups language plpgsql security definer set search_path = '' as $$
declare
  v_fu public.follow_ups;
begin
  perform private.require_staff();
  select * into v_fu from public.follow_ups where id = p_id;
  if not found then
    raise exception using errcode = 'CR404', message = 'Follow-up not found.';
  end if;
  perform private.lock_lead_for_write(v_fu.lead_id);
  select * into v_fu from public.follow_ups where id = p_id for update;
  perform private.check_version(v_fu.version, p_expected_version);
  if v_fu.status <> 'pending' then
    raise exception using errcode = 'CR409', message = 'This follow-up is already ' || v_fu.status || '.';
  end if;
  return v_fu;
end $$;

create or replace function public.complete_follow_up(
  p_request_id uuid, p_follow_up_id uuid, p_expected_version int, p_outcome text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb := private.claim_request(p_request_id, 'complete_follow_up');
  v_fu public.follow_ups;
  v_outcome text := nullif(btrim(coalesce(p_outcome, '')), '');
begin
  if v_replay is not null then return v_replay; end if;
  v_fu := private.lock_follow_up_for_write(p_follow_up_id, p_expected_version);
  update public.follow_ups
     set status = 'completed', completed_at = now(), completed_by = auth.uid(),
         outcome = v_outcome, version = version + 1
   where id = v_fu.id;
  update public.leads set last_activity_at = now() where id = v_fu.lead_id;
  perform private.log_event(v_fu.lead_id, 'follow_up_completed', jsonb_build_object(
    'follow_up_id', v_fu.id, 'purpose', v_fu.purpose, 'outcome', v_outcome, 'due_at', v_fu.due_at));
  return private.finish_request(p_request_id, jsonb_build_object('id', v_fu.id));
end $$;

create or replace function public.reschedule_follow_up(
  p_request_id uuid, p_follow_up_id uuid, p_expected_version int, p_due_at timestamptz, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb := private.claim_request(p_request_id, 'reschedule_follow_up');
  v_fu public.follow_ups;
begin
  if v_replay is not null then return v_replay; end if;
  v_fu := private.lock_follow_up_for_write(p_follow_up_id, p_expected_version);
  if p_due_at is null or p_due_at < now() - interval '5 minutes' then
    raise exception using errcode = 'CR422', message = 'Choose a future time.';
  end if;
  update public.follow_ups
     set due_at = p_due_at, reschedule_count = reschedule_count + 1,
         reminder_sent_at = null, overdue_notified_at = null, version = version + 1
   where id = v_fu.id;
  perform private.log_event(v_fu.lead_id, 'follow_up_rescheduled', jsonb_build_object(
    'follow_up_id', v_fu.id, 'purpose', v_fu.purpose, 'from', v_fu.due_at, 'to', p_due_at,
    'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  return private.finish_request(p_request_id, jsonb_build_object('id', v_fu.id));
end $$;

create or replace function public.cancel_follow_up(
  p_request_id uuid, p_follow_up_id uuid, p_expected_version int, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb := private.claim_request(p_request_id, 'cancel_follow_up');
  v_fu public.follow_ups;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_replay is not null then return v_replay; end if;
  if v_reason is null then
    raise exception using errcode = 'CR422', message = 'Give a reason for cancelling.';
  end if;
  v_fu := private.lock_follow_up_for_write(p_follow_up_id, p_expected_version);
  update public.follow_ups
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = v_reason, version = version + 1
   where id = v_fu.id;
  perform private.log_event(v_fu.lead_id, 'follow_up_cancelled', jsonb_build_object(
    'follow_up_id', v_fu.id, 'purpose', v_fu.purpose, 'reason', v_reason));
  return private.finish_request(p_request_id, jsonb_build_object('id', v_fu.id));
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  perform private.require_staff();
  update public.notifications
     set read_at = now()
   where recipient_id = auth.uid() and read_at is null
     and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return jsonb_build_object('updated', v_count);
end $$;

-- ---------------------------------------------------------------------------
-- Staff & settings
-- ---------------------------------------------------------------------------
create or replace function public.update_my_profile(p_full_name text, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  update public.profiles
     set full_name = btrim(p_full_name), phone = nullif(btrim(coalesce(p_phone, '')), '')
   where id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_update_staff(
  p_request_id uuid, p_user_id uuid, p_role text default null, p_is_active boolean default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb := private.claim_request(p_request_id, 'admin_update_staff');
  v_old public.profiles;
  v_new public.profiles;
begin
  if v_replay is not null then return v_replay; end if;
  perform private.require_admin();
  select * into v_old from public.profiles where id = p_user_id for update;
  if not found then
    raise exception using errcode = 'CR404', message = 'Team member not found.';
  end if;
  if p_role is not null and p_role not in ('admin', 'manager', 'salesperson') then
    raise exception using errcode = 'CR422', message = 'Invalid role.';
  end if;
  update public.profiles
     set role = coalesce(p_role, role),
         is_active = coalesce(p_is_active, is_active),
         deactivated_at = case
           when p_is_active is false and is_active then now()
           when p_is_active is true then null
           else deactivated_at end
   where id = p_user_id
  returning * into v_new;

  if v_old.role <> v_new.role then
    perform private.audit('staff_role_changed', 'profile', p_user_id::text,
      jsonb_build_object('from', v_old.role, 'to', v_new.role, 'name', v_new.full_name));
  end if;
  if v_old.is_active <> v_new.is_active then
    perform private.audit(case when v_new.is_active then 'staff_reactivated' else 'staff_deactivated' end,
      'profile', p_user_id::text, jsonb_build_object('name', v_new.full_name));
  end if;
  return private.finish_request(p_request_id, jsonb_build_object(
    'role', v_new.role, 'is_active', v_new.is_active));
end $$;

create or replace function public.update_business_settings(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_old public.business_settings;
  v_new public.business_settings;
  v_key text;
begin
  perform private.require_admin();
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('business_name', 'reminder_lead_minutes', 'salesperson_export_enabled',
                     'lost_reasons', 'unqualified_reasons') then
      raise exception using errcode = 'CR422', message = format('Setting %s cannot be changed.', v_key);
    end if;
  end loop;
  select * into v_old from public.business_settings where id = 1 for update;
  update public.business_settings s set
    business_name = coalesce(btrim(p_patch->>'business_name'), s.business_name),
    reminder_lead_minutes = coalesce((p_patch->>'reminder_lead_minutes')::int, s.reminder_lead_minutes),
    salesperson_export_enabled = coalesce((p_patch->>'salesperson_export_enabled')::boolean, s.salesperson_export_enabled),
    lost_reasons = case when p_patch ? 'lost_reasons'
      then array(select btrim(x) from jsonb_array_elements_text(p_patch->'lost_reasons') x where btrim(x) <> '')
      else s.lost_reasons end,
    unqualified_reasons = case when p_patch ? 'unqualified_reasons'
      then array(select btrim(x) from jsonb_array_elements_text(p_patch->'unqualified_reasons') x where btrim(x) <> '')
      else s.unqualified_reasons end,
    updated_by = auth.uid(), updated_at = now()
  where id = 1 returning * into v_new;
  perform private.audit('settings_updated', 'business_settings', '1',
    jsonb_build_object('before', to_jsonb(v_old) - 'updated_at' - 'updated_by',
                       'after', to_jsonb(v_new) - 'updated_at' - 'updated_by'));
  return to_jsonb(v_new);
end $$;

create or replace function public.record_export(p_scope text, p_format text, p_layout text, p_row_count int, p_filters jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  perform private.audit('export', 'leads', null, jsonb_build_object(
    'scope', p_scope, 'format', p_format, 'layout', p_layout, 'rows', p_row_count, 'filters', p_filters));
end $$;
