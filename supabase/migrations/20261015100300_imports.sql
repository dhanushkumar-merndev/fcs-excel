-- Import pipeline: batch → staged rows (validated server-side in the app) → chunked processing.
-- Idempotency: client_token per batch, (batch,row_number) per row, and unique source IDs /
-- source fingerprints per lead. Concurrent processors use SKIP LOCKED; each row runs in its
-- own subtransaction so one bad row never aborts the rest.

create or replace function public.import_create_batch(p_client_token uuid, p_meta jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.import_batches;
  v_owner uuid := nullif(p_meta->>'default_owner_id', '')::uuid;
  v_total int := coalesce((p_meta->>'total_rows')::int, 0);
begin
  perform private.require_manager();
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
    event_year_choice, default_owner_id, uploaded_by, total_rows
  ) values (
    p_client_token, left(coalesce(p_meta->>'file_name', 'upload'), 255), (p_meta->>'file_size')::bigint,
    p_meta->>'file_sha256', p_meta->>'sheet_name', coalesce(p_meta->'column_mapping', '{}'::jsonb),
    p_meta->'event_year_choice', v_owner, auth.uid(), v_total
  )
  on conflict (client_token) do nothing
  returning * into v_batch;

  if v_batch.id is null then
    select * into v_batch from public.import_batches where client_token = p_client_token;
    return to_jsonb(v_batch) || jsonb_build_object('existing', true);
  end if;
  return to_jsonb(v_batch) || jsonb_build_object('existing', false);
end $$;

create or replace function public.import_set_storage_path(p_batch_id uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_manager();
  update public.import_batches set storage_path = p_path where id = p_batch_id;
end $$;

-- p_rows: [{row_number, raw, normalized, issues, warnings, decision, status, skip_reason}]
create or replace function public.import_stage_rows(p_batch_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.import_batches;
  v_staged int;
begin
  perform private.require_manager();
  select * into v_batch from public.import_batches where id = p_batch_id for update;
  if not found then
    raise exception using errcode = 'CR404', message = 'Import not found.';
  end if;
  if v_batch.status <> 'staging' then
    -- Already fully staged (e.g. a retried request): report current state.
    return jsonb_build_object('staged', v_batch.staged_rows, 'total', v_batch.total_rows, 'status', v_batch.status);
  end if;

  insert into public.import_rows (batch_id, row_number, raw, normalized, issues, warnings, decision, status, skip_reason)
  select p_batch_id, (r->>'row_number')::int, r->'raw', r->'normalized',
         coalesce(r->'issues', '[]'::jsonb), coalesce(r->'warnings', '[]'::jsonb),
         coalesce(r->>'decision', 'import'), coalesce(r->>'status', 'pending'), r->>'skip_reason'
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'status', 'pending') in ('pending', 'invalid', 'skipped')
  on conflict (batch_id, row_number) do nothing;

  select count(*) into v_staged from public.import_rows where batch_id = p_batch_id;
  if v_staged > 1000 or v_staged > v_batch.total_rows then
    raise exception using errcode = 'CR422', message = 'More rows were sent than the import declared (limit 1,000).';
  end if;

  update public.import_batches
     set staged_rows = v_staged,
         status = case when v_staged = total_rows then 'ready' else 'staging' end,
         warning_count = (select count(*) from public.import_rows
                          where batch_id = p_batch_id and jsonb_array_length(warnings) > 0),
         last_heartbeat_at = now()
   where id = p_batch_id
  returning * into v_batch;
  return jsonb_build_object('staged', v_batch.staged_rows, 'total', v_batch.total_rows, 'status', v_batch.status);
end $$;

-- Existing leads that match incoming phones or source IDs (for duplicate review).
create or replace function public.import_find_matches(p_phones text[], p_external_ids text[], p_raw_ids text[] default '{}')
returns table (
  lead_id uuid, lead_number bigint, customer_name text, phone_e164 text, source_system text,
  external_lead_id text, external_lead_id_raw text, event_date date, event_date_status text,
  occasion_code text, menu_code text, guest_range text, event_address text, stage text,
  owner_id uuid, owner_name text, acquired_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_manager();
  return query
  select l.id, l.lead_number, l.customer_name, l.phone_e164, l.source_system,
         l.external_lead_id, l.external_lead_id_raw, l.event_date, l.event_date_status,
         l.occasion_code, l.menu_code, l.guest_range, l.event_address, l.stage,
         l.owner_id, p.full_name, l.acquired_at
  from public.leads l
  left join public.profiles p on p.id = l.owner_id
  where l.phone_e164 = any (coalesce(p_phones, '{}'))
     or l.external_lead_id = any (coalesce(p_external_ids, '{}'))
     or l.external_lead_id_raw = any (coalesce(p_raw_ids, '{}'))
  limit 5000;
end $$;

create or replace function private.refresh_import_counts(p_batch_id uuid) returns public.import_batches
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.import_batches;
begin
  update public.import_batches b set
    created_count = c.created, skipped_count = c.skipped, invalid_count = c.invalid,
    failed_count = c.failed, pending_count = c.pending, review_count = c.review,
    last_heartbeat_at = now()
  from (
    select count(*) filter (where r.status = 'created') as created,
           count(*) filter (where r.status = 'skipped') as skipped,
           count(*) filter (where r.status = 'invalid') as invalid,
           count(*) filter (where r.status = 'failed') as failed,
           count(*) filter (where r.status = 'pending') as pending,
           count(*) filter (where r.status = 'created' and coalesce(jsonb_array_length(r.normalized->'review_flags'), 0) > 0) as review
    from public.import_rows r where r.batch_id = p_batch_id
  ) c
  where b.id = p_batch_id
  returning b.* into v_batch;
  return v_batch;
end $$;

create or replace function public.import_process_rows(p_batch_id uuid, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.import_batches;
  v_row public.import_rows;
  n jsonb;
  v_lead_id uuid;
  v_existing uuid;
  v_owner uuid;
  v_processed int := 0;
  v_owner_created int := 0;
  v_flags text[];
begin
  perform private.require_manager();
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
        p_batch_id, v_row.row_number, auth.uid()
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
        values (v_lead_id, auth.uid(), 'lead_imported', jsonb_build_object(
          'batch_id', p_batch_id, 'file_name', v_batch.file_name, 'row_number', v_row.row_number,
          'review_flags', to_jsonb(v_flags),
          'kept_as_separate_enquiry_of', v_row.warnings));
        if v_owner is not null then
          insert into public.assignment_history (lead_id, previous_owner_id, new_owner_id, assigned_by, reason)
          values (v_lead_id, null, v_owner, auth.uid(), 'Assigned during import');
          insert into public.lead_events (lead_id, actor_id, event_type, payload)
          values (v_lead_id, auth.uid(), 'assigned', jsonb_build_object(
            'from_owner_id', null, 'to_owner_id', v_owner, 'to_name', private.staff_name(v_owner),
            'reason', 'Assigned during import'));
          v_owner_created := v_owner_created + 1;
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

    perform private.notify(v_batch.uploaded_by, 'import_completed',
      format('Import finished: %s', v_batch.file_name),
      format('%s created · %s skipped · %s invalid · %s failed',
             v_batch.created_count, v_batch.skipped_count, v_batch.invalid_count, v_batch.failed_count),
      '/imports/' || p_batch_id, null, null, p_batch_id,
      'import_done:' || p_batch_id || ':' || v_batch.completion_runs);

    if v_owner is not null and v_owner <> v_batch.uploaded_by and v_batch.created_count > 0 then
      perform private.notify(v_owner, 'lead_assigned',
        format('%s new leads assigned to you', v_batch.created_count),
        'From import ' || v_batch.file_name, '/leads?import=' || p_batch_id, null, null, p_batch_id,
        'import_assigned:' || p_batch_id || ':' || v_batch.completion_runs);
    end if;
  end if;

  return jsonb_build_object(
    'status', v_batch.status, 'total', v_batch.total_rows, 'processed_now', v_processed,
    'created', v_batch.created_count, 'skipped', v_batch.skipped_count,
    'invalid', v_batch.invalid_count, 'failed', v_batch.failed_count,
    'pending', v_batch.pending_count, 'warnings', v_batch.warning_count);
end $$;

create or replace function public.import_retry_failed(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  perform private.require_manager();
  update public.import_rows set status = 'pending', error_message = null, processed_at = null
  where batch_id = p_batch_id and status = 'failed';
  get diagnostics v_count = row_count;
  if v_count > 0 then
    update public.import_batches set status = 'processing', finished_at = null where id = p_batch_id;
    perform private.refresh_import_counts(p_batch_id);
  end if;
  return jsonb_build_object('reset', v_count);
end $$;

create or replace function public.import_cancel(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.import_batches;
begin
  perform private.require_manager();
  select * into v_batch from public.import_batches where id = p_batch_id for update;
  if not found then
    raise exception using errcode = 'CR404', message = 'Import not found.';
  end if;
  if exists (select 1 from public.import_rows where batch_id = p_batch_id and status = 'created') then
    raise exception using errcode = 'CR409', message = 'Leads were already created from this import, so it cannot be discarded. Use Resume instead.';
  end if;
  update public.import_batches set status = 'cancelled', finished_at = now() where id = p_batch_id;
  return jsonb_build_object('status', 'cancelled');
end $$;
