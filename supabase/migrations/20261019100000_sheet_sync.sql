-- Google Sheet sync. Every 10 minutes pg_cron + pg_net POST /api/sync/sheet (set up by
-- `pnpm sync:setup`, which keeps the URL and the cron secret in Vault). The app reads the sheet's
-- CSV export and sends new rows through the normal import pipeline as the configured sync actor.
--
-- The import RPCs check the signed-in manager; the sync runs with the server's secret key and no
-- session. So each import RPC's body moves into a private "core" that takes the actor, the public
-- RPCs stay exactly as before (role check, then core as auth.uid()), and the sheet_sync_* RPCs —
-- executable by service_role only — call the same cores as the sync actor.

-- Sync batches are marked so they don't send an "Import finished" notification every 10 minutes.
alter table public.import_batches add column origin text not null default 'upload'
  check (origin in ('upload', 'sheet_sync'));

create table public.sheet_sync (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  -- Configuration (set by pnpm sync:setup; never readable by staff).
  sheet_id text,
  sheet_gid text,
  actor_id uuid references public.profiles (id),
  cron_secret_sha256 text,
  -- Lock: one run at a time; a run that died is taken over after 5 minutes.
  run_token uuid,
  running_since timestamptz,
  -- What staff see.
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_synced_at timestamptz,
  last_status text not null default 'never' check (last_status in ('never', 'ok', 'unchanged', 'error')),
  last_error text,
  last_created int not null default 0,
  last_skipped int not null default 0,
  last_invalid int not null default 0,
  last_batch_id uuid references public.import_batches (id),
  consecutive_failures int not null default 0,
  -- Progress through the sheet (see src/lib/sheet-sync/plan.ts).
  content_hash text,
  processed_through_row int not null default 0,
  prefix_hash text,
  has_more boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.sheet_sync (id) values (1) on conflict (id) do nothing;

alter table public.sheet_sync enable row level security;
grant select on public.sheet_sync to service_role;
grant select (
  id, enabled, running_since, last_started_at, last_finished_at, last_synced_at, last_status, last_error,
  last_created, last_skipped, last_invalid, last_batch_id, consecutive_failures, updated_at
) on public.sheet_sync to authenticated;
create policy "staff read sheet sync" on public.sheet_sync
  for select to authenticated using ((select private.is_staff()));

-- ---------------------------------------------------------------------------
-- Import cores (bodies unchanged except the actor parameter and the sync origin)
-- ---------------------------------------------------------------------------
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
    event_year_choice, default_owner_id, uploaded_by, total_rows, origin
  ) values (
    p_client_token, left(coalesce(p_meta->>'file_name', 'upload'), 255), (p_meta->>'file_size')::bigint,
    p_meta->>'file_sha256', p_meta->>'sheet_name', coalesce(p_meta->'column_mapping', '{}'::jsonb),
    p_meta->'event_year_choice', v_owner, p_actor, v_total, p_origin
  )
  on conflict (client_token) do nothing
  returning * into v_batch;

  if v_batch.id is null then
    select * into v_batch from public.import_batches where client_token = p_client_token;
    return to_jsonb(v_batch) || jsonb_build_object('existing', true);
  end if;
  return to_jsonb(v_batch) || jsonb_build_object('existing', false);
end $$;

create or replace function private.import_stage_rows_core(p_batch_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.import_batches;
  v_staged int;
begin
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

create or replace function private.import_find_matches_core(p_phones text[], p_external_ids text[], p_raw_ids text[])
returns table (
  lead_id uuid, lead_number bigint, customer_name text, phone_e164 text, source_system text,
  external_lead_id text, external_lead_id_raw text, event_date date, event_date_status text,
  occasion_code text, menu_code text, guest_range text, event_address text, stage text,
  owner_id uuid, owner_name text, acquired_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select l.id, l.lead_number, l.customer_name, l.phone_e164, l.source_system,
         l.external_lead_id, l.external_lead_id_raw, l.event_date, l.event_date_status,
         l.occasion_code, l.menu_code, l.guest_range, l.event_address, l.stage,
         l.owner_id, p.full_name, l.acquired_at
  from public.leads l
  left join public.profiles p on p.id = l.owner_id
  where l.phone_e164 = any (coalesce(p_phones, '{}'))
     or l.external_lead_id = any (coalesce(p_external_ids, '{}'))
     or l.external_lead_id_raw = any (coalesce(p_raw_ids, '{}'))
  limit 5000
$$;

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
  v_owner_created int := 0;
  v_flags text[];
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
        if v_owner is not null then
          insert into public.assignment_history (lead_id, previous_owner_id, new_owner_id, assigned_by, reason)
          values (v_lead_id, null, v_owner, p_actor, 'Assigned during import');
          insert into public.lead_events (lead_id, actor_id, event_type, payload)
          values (v_lead_id, p_actor, 'assigned', jsonb_build_object(
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

    -- Sheet sync runs every 10 minutes; its status shows in the top bar instead.
    if v_batch.origin <> 'sheet_sync' then
      perform private.notify(v_batch.uploaded_by, 'import_completed',
        format('Import finished: %s', private.import_label(v_batch.file_name, v_batch.sheet_name)),
        format('%s created · %s skipped · %s invalid · %s failed',
               v_batch.created_count, v_batch.skipped_count, v_batch.invalid_count, v_batch.failed_count),
        '/imports/' || p_batch_id, null, null, p_batch_id,
        'import_done:' || p_batch_id || ':' || v_batch.completion_runs);
    end if;

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

-- ---------------------------------------------------------------------------
-- Public import RPCs: unchanged behaviour (signed-in admin or manager, acting as themselves)
-- ---------------------------------------------------------------------------
create or replace function public.import_create_batch(p_client_token uuid, p_meta jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_manager();
  return private.import_create_batch_core(auth.uid(), 'upload', p_client_token, p_meta);
end $$;

create or replace function public.import_stage_rows(p_batch_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_manager();
  return private.import_stage_rows_core(p_batch_id, p_rows);
end $$;

create or replace function public.import_find_matches(p_phones text[], p_external_ids text[], p_raw_ids text[] default '{}')
returns table (
  lead_id uuid, lead_number bigint, customer_name text, phone_e164 text, source_system text,
  external_lead_id text, external_lead_id_raw text, event_date date, event_date_status text,
  occasion_code text, menu_code text, guest_range text, event_address text, stage text,
  owner_id uuid, owner_name text, acquired_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_manager();
  return query select * from private.import_find_matches_core(p_phones, p_external_ids, p_raw_ids);
end $$;

create or replace function public.import_process_rows(p_batch_id uuid, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_manager();
  return private.import_process_rows_core(auth.uid(), p_batch_id, p_limit);
end $$;

-- ---------------------------------------------------------------------------
-- Sheet sync RPCs (service_role only)
-- ---------------------------------------------------------------------------

-- Raises unless p_token is the current run's token (a run that lost its lock must stop writing).
create or replace function private.sheet_sync_require_run(p_token uuid) returns public.sheet_sync
language plpgsql security definer set search_path = '' as $$
declare
  v_sync public.sheet_sync;
begin
  select * into v_sync from public.sheet_sync where id = 1;
  if p_token is null or v_sync.run_token is distinct from p_token then
    raise exception using errcode = 'CR409', message = 'This sync run no longer holds the lock.';
  end if;
  return v_sync;
end $$;

-- Starts a run. p_secret is the bearer secret from pg_cron (checked here); a manual run passes
-- null after the route has checked the signed-in admin or manager. Returns {claimed:false, reason}
-- when sync is off, not set up, already running, or the secret is wrong.
create or replace function public.sheet_sync_claim(p_secret text, p_manual boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sync public.sheet_sync;
begin
  select * into v_sync from public.sheet_sync where id = 1 for update;
  if not p_manual and (p_secret is null or v_sync.cron_secret_sha256 is null
      or encode(sha256(convert_to(p_secret, 'UTF8')), 'hex') <> v_sync.cron_secret_sha256) then
    return jsonb_build_object('claimed', false, 'reason', 'unauthorized');
  end if;
  if not v_sync.enabled then
    return jsonb_build_object('claimed', false, 'reason', 'disabled');
  end if;
  if v_sync.sheet_id is null or v_sync.actor_id is null
     or not exists (select 1 from public.profiles where id = v_sync.actor_id and is_active) then
    return jsonb_build_object('claimed', false, 'reason', 'not_configured');
  end if;
  if v_sync.running_since is not null and v_sync.running_since > now() - interval '5 minutes' then
    return jsonb_build_object('claimed', false, 'reason', 'busy');
  end if;

  update public.sheet_sync
     set run_token = gen_random_uuid(), running_since = now(), last_started_at = now(), updated_at = now()
   where id = 1
  returning * into v_sync;

  return jsonb_build_object(
    'claimed', true,
    'token', v_sync.run_token,
    'sheet_id', v_sync.sheet_id,
    'sheet_gid', v_sync.sheet_gid,
    'content_hash', v_sync.content_hash,
    'processed_through_row', v_sync.processed_through_row,
    'prefix_hash', v_sync.prefix_hash,
    'has_more', v_sync.has_more,
    -- Batches a previous run staged but didn't finish processing (resumed first).
    'pending_batch_ids', coalesce((
      select jsonb_agg(b.id order by b.created_at)
        from public.import_batches b
       where b.origin = 'sheet_sync' and b.status in ('ready', 'processing')), '[]'::jsonb));
end $$;

-- Which source keys are NOT in the CRM yet. Index probes only (leads_source_external_unique and
-- leads_source_fingerprint_key), so the cost follows the number of keys sent, not the table size.
create or replace function public.sheet_sync_missing_keys(p_external_ids text[], p_fingerprints text[])
returns table (kind text, key text) language sql stable security definer set search_path = '' as $$
  select 'id', k from unnest(coalesce(p_external_ids, '{}')) k
   where not exists (select 1 from public.leads l where l.source_system = 'meta_lead_ads' and l.external_lead_id = k)
  union all
  select 'fp', k from unnest(coalesce(p_fingerprints, '{}')) k
   where not exists (select 1 from public.leads l where l.source_fingerprint = k)
$$;

create or replace function public.sheet_sync_find_matches(p_phones text[], p_external_ids text[], p_raw_ids text[] default '{}')
returns table (
  lead_id uuid, lead_number bigint, customer_name text, phone_e164 text, source_system text,
  external_lead_id text, external_lead_id_raw text, event_date date, event_date_status text,
  occasion_code text, menu_code text, guest_range text, event_address text, stage text,
  owner_id uuid, owner_name text, acquired_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select * from private.import_find_matches_core(p_phones, p_external_ids, p_raw_ids)
$$;

-- Creates one sync batch (≤ 1,000 rows) and stages its rows in one call. Idempotent on
-- p_client_token: a retried run gets the same batch back.
create or replace function public.sheet_sync_stage(p_token uuid, p_client_token uuid, p_meta jsonb, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sync public.sheet_sync := private.sheet_sync_require_run(p_token);
  v_batch jsonb;
begin
  v_batch := private.import_create_batch_core(v_sync.actor_id, 'sheet_sync', p_client_token, p_meta);
  if v_batch->>'origin' <> 'sheet_sync' then
    raise exception using errcode = 'CR409', message = 'That import is not a sheet sync batch.';
  end if;
  return jsonb_build_object('batch_id', v_batch->>'id')
    || private.import_stage_rows_core((v_batch->>'id')::uuid, p_rows);
end $$;

create or replace function public.sheet_sync_process(p_token uuid, p_batch_id uuid, p_limit int default 250)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sync public.sheet_sync := private.sheet_sync_require_run(p_token);
begin
  if not exists (select 1 from public.import_batches where id = p_batch_id and origin = 'sheet_sync') then
    raise exception using errcode = 'CR404', message = 'Sync batch not found.';
  end if;
  return private.import_process_rows_core(v_sync.actor_id, p_batch_id, p_limit);
end $$;

-- Saves how far through the sheet this run got, once its rows are safely staged.
create or replace function public.sheet_sync_checkpoint(
  p_token uuid, p_content_hash text, p_processed_through_row int, p_prefix_hash text, p_has_more boolean
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.sheet_sync_require_run(p_token);
  update public.sheet_sync
     set content_hash = p_content_hash, processed_through_row = greatest(0, p_processed_through_row),
         prefix_hash = p_prefix_hash, has_more = coalesce(p_has_more, false), updated_at = now()
   where id = 1;
end $$;

-- Ends a run and releases the lock. Counts come from the batches this run staged. After 3 failed
-- runs in a row, active admins get one notification per outage.
create or replace function public.sheet_sync_finish(p_token uuid, p_status text, p_error text, p_batch_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sync public.sheet_sync := private.sheet_sync_require_run(p_token);
  v_ok boolean := p_status in ('ok', 'unchanged');
  v_admin record;
begin
  if p_status not in ('ok', 'unchanged', 'error') then
    raise exception using errcode = 'CR422', message = 'Unknown sync status.';
  end if;

  update public.sheet_sync s set
    run_token = null, running_since = null, last_finished_at = now(), updated_at = now(),
    last_status = p_status,
    last_error = case when v_ok then null else left(coalesce(p_error, 'Sync failed.'), 500) end,
    last_synced_at = case when v_ok then now() else s.last_synced_at end,
    consecutive_failures = case when v_ok then 0 else s.consecutive_failures + 1 end,
    last_created = case when v_ok then c.created else s.last_created end,
    last_skipped = case when v_ok then c.skipped else s.last_skipped end,
    last_invalid = case when v_ok then c.invalid else s.last_invalid end,
    last_batch_id = case when v_ok and c.last_id is not null then c.last_id else s.last_batch_id end
  from (
    select coalesce(sum(b.created_count), 0)::int as created,
           coalesce(sum(b.skipped_count), 0)::int as skipped,
           coalesce(sum(b.invalid_count), 0)::int as invalid,
           (array_agg(b.id order by b.created_at desc))[1] as last_id
      from public.import_batches b
     where b.id = any (coalesce(p_batch_ids, '{}')) and b.origin = 'sheet_sync'
  ) c
  where s.id = 1
  returning s.* into v_sync;

  if not v_ok and v_sync.consecutive_failures = 3 then
    for v_admin in select id from public.profiles where role = 'admin' and is_active loop
      perform private.notify(v_admin.id, 'system', 'Google Sheet sync is failing',
        left(coalesce(p_error, 'Sync failed.'), 200), '/imports', null, null, null,
        'sheet_sync_failing:' || v_admin.id || ':' || coalesce(v_sync.last_synced_at::text, 'never'));
    end loop;
  end if;

  return jsonb_build_object(
    'status', v_sync.last_status, 'created', v_sync.last_created, 'skipped', v_sync.last_skipped,
    'invalid', v_sync.last_invalid, 'last_synced_at', v_sync.last_synced_at);
end $$;

revoke all on function
  private.import_create_batch_core(uuid, text, uuid, jsonb), private.import_stage_rows_core(uuid, jsonb),
  private.import_find_matches_core(text[], text[], text[]), private.import_process_rows_core(uuid, uuid, int),
  private.sheet_sync_require_run(uuid)
from public, anon, authenticated;

revoke all on function
  public.sheet_sync_claim(text, boolean), public.sheet_sync_missing_keys(text[], text[]),
  public.sheet_sync_find_matches(text[], text[], text[]), public.sheet_sync_stage(uuid, uuid, jsonb, jsonb),
  public.sheet_sync_process(uuid, uuid, int), public.sheet_sync_checkpoint(uuid, text, int, text, boolean),
  public.sheet_sync_finish(uuid, text, text, uuid[])
from public, anon, authenticated;
grant execute on function
  public.sheet_sync_claim(text, boolean), public.sheet_sync_missing_keys(text[], text[]),
  public.sheet_sync_find_matches(text[], text[], text[]), public.sheet_sync_stage(uuid, uuid, jsonb, jsonb),
  public.sheet_sync_process(uuid, uuid, int), public.sheet_sync_checkpoint(uuid, text, int, text, boolean),
  public.sheet_sync_finish(uuid, text, text, uuid[])
to service_role;
