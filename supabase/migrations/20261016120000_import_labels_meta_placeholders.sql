-- Import names that say which sheet they came from, and Meta's "no permission" placeholders cleared.

-- "CHEF ON DEMAND · Khanabanao Meta Ad's.xlsx"; just the file name for CSVs and default sheet names.
create or replace function private.import_label(p_file text, p_sheet text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_sheet is null or btrim(p_sheet) = '' or btrim(p_sheet) ~* '^(csv|sheet ?[0-9]*)$' then p_file
    else btrim(p_sheet) || ' · ' || p_file
  end
$$;
revoke all on function private.import_label(text, text) from public, anon, authenticated;

-- Same as before, except the completion notifications name the sheet.
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
      format('Import finished: %s', private.import_label(v_batch.file_name, v_batch.sheet_name)),
      format('%s created · %s skipped · %s invalid · %s failed',
             v_batch.created_count, v_batch.skipped_count, v_batch.invalid_count, v_batch.failed_count),
      '/imports/' || p_batch_id, null, null, p_batch_id,
      'import_done:' || p_batch_id || ':' || v_batch.completion_runs);

    if v_owner is not null and v_owner <> v_batch.uploaded_by and v_batch.created_count > 0 then
      perform private.notify(v_owner, 'lead_assigned',
        format('%s new leads assigned to you', v_batch.created_count),
        'From import ' || private.import_label(v_batch.file_name, v_batch.sheet_name), '/leads?import=' || p_batch_id, null, null, p_batch_id,
        'import_assigned:' || p_batch_id || ':' || v_batch.completion_runs);
    end if;
  end if;

  return jsonb_build_object(
    'status', v_batch.status, 'total', v_batch.total_rows, 'processed_now', v_processed,
    'created', v_batch.created_count, 'skipped', v_batch.skipped_count,
    'invalid', v_batch.invalid_count, 'failed', v_batch.failed_count,
    'pending', v_batch.pending_count, 'warnings', v_batch.warning_count);
end $$;

-- Notifications already sent for finished imports get the sheet name too.
update public.notifications n
   set title = 'Import finished: ' || private.import_label(b.file_name, b.sheet_name)
  from public.import_batches b
 where n.type = 'import_completed' and n.import_batch_id = b.id;

-- When the exporter can't see the ad account, Meta writes "You don't have enough permission(s)…"
-- into the ad, ad set and campaign columns. That isn't a name or an ID: clear it (the original
-- text stays in each lead's source row).
update public.leads set
  ad_id         = case when ad_id         ~* 'have enough permission' then null else ad_id end,
  ad_name       = case when ad_name       ~* 'have enough permission' then null else ad_name end,
  adset_id      = case when adset_id      ~* 'have enough permission' then null else adset_id end,
  adset_name    = case when adset_name    ~* 'have enough permission' then null else adset_name end,
  campaign_id   = case when campaign_id   ~* 'have enough permission' then null else campaign_id end,
  campaign_name = case when campaign_name ~* 'have enough permission' then null else campaign_name end,
  form_id       = case when form_id       ~* 'have enough permission' then null else form_id end,
  form_name     = case when form_name     ~* 'have enough permission' then null else form_name end
 where concat_ws(' ', ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, form_id, form_name) ~* 'have enough permission';
