-- Google Sheet sync reads every tab of the sheet, not one. Each tab keeps its own progress in
-- public.sheet_sync_tabs; public.sheet_sync keeps the sheet, the lock and the overall status.
-- "All tabs" (the default) also picks up tabs added to the sheet later. Admins and managers set the
-- sheet, the tabs and how often it runs from the app (sheet_sync_configure) instead of a script.

alter table public.sheet_sync
  add column all_tabs boolean not null default true,
  add column interval_minutes int not null default 10 check (interval_minutes in (5, 10, 15, 30, 60));
grant select (all_tabs, interval_minutes) on public.sheet_sync to authenticated;
comment on column public.sheet_sync.sheet_gid is 'Unused since 20261026100000 (tabs are in sheet_sync_tabs).';

create table public.sheet_sync_tabs (
  gid text primary key check (gid ~ '^\d{1,12}$'),
  name text not null,
  position int not null default 0,
  enabled boolean not null default true,
  -- No longer in the sheet (deleted or the sheet changed); kept for its history.
  removed boolean not null default false,
  -- Progress through this tab (see src/lib/sheet-sync/plan.ts).
  content_hash text,
  processed_through_row int not null default 0,
  prefix_hash text,
  has_more boolean not null default false,
  -- What staff see.
  last_checked_at timestamptz,
  last_synced_at timestamptz,
  last_status text not null default 'never' check (last_status in ('never', 'ok', 'unchanged', 'error')),
  last_error text,
  last_created int not null default 0,
  last_skipped int not null default 0,
  last_invalid int not null default 0,
  last_batch_id uuid references public.import_batches (id),
  updated_at timestamptz not null default now()
);

alter table public.sheet_sync_tabs enable row level security;
grant select on public.sheet_sync_tabs to service_role;
grant select (
  gid, name, position, enabled, removed, last_checked_at, last_synced_at, last_status, last_error,
  last_created, last_skipped, last_invalid, last_batch_id, updated_at
) on public.sheet_sync_tabs to authenticated;
create policy "staff read sheet sync tabs" on public.sheet_sync_tabs
  for select to authenticated using ((select private.is_staff()));

-- The tab synced so far keeps its progress; every other tab is found on the next run.
insert into public.sheet_sync_tabs (gid, name, content_hash, processed_through_row, prefix_hash, has_more,
                                    last_checked_at, last_synced_at, last_status)
select coalesce(s.sheet_gid, '0'), 'Tab ' || coalesce(s.sheet_gid, '0'), s.content_hash, s.processed_through_row,
       s.prefix_hash, s.has_more, s.last_finished_at, s.last_synced_at, s.last_status
  from public.sheet_sync s
 where s.id = 1 and s.sheet_id is not null;

-- ---------------------------------------------------------------------------
-- Run RPCs (service_role only)
-- ---------------------------------------------------------------------------

create or replace function private.sheet_sync_tabs_json() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'gid', t.gid, 'name', t.name, 'position', t.position, 'enabled', t.enabled, 'removed', t.removed,
           'content_hash', t.content_hash, 'processed_through_row', t.processed_through_row,
           'prefix_hash', t.prefix_hash, 'has_more', t.has_more, 'last_checked_at', t.last_checked_at)
         order by t.position, t.gid), '[]'::jsonb)
    from public.sheet_sync_tabs t
$$;

-- As before, plus: scheduled runs wait for the chosen interval ("not_due"), and the claim carries
-- every tab with its progress.
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
  -- pg_cron fires every 5 minutes; a minute of slack keeps a 10-minute interval at 10, not 15.
  if not p_manual and v_sync.last_started_at is not null
     and v_sync.last_started_at > now() - make_interval(mins => v_sync.interval_minutes) + interval '1 minute' then
    return jsonb_build_object('claimed', false, 'reason', 'not_due');
  end if;

  update public.sheet_sync
     set run_token = gen_random_uuid(), running_since = now(), last_started_at = now(), updated_at = now()
   where id = 1
  returning * into v_sync;

  return jsonb_build_object(
    'claimed', true,
    'token', v_sync.run_token,
    'sheet_id', v_sync.sheet_id,
    'all_tabs', v_sync.all_tabs,
    'tabs', private.sheet_sync_tabs_json(),
    'pending_batch_ids', coalesce((
      select jsonb_agg(b.id order by b.created_at)
        from public.import_batches b
       where b.origin = 'sheet_sync' and b.status in ('ready', 'processing')), '[]'::jsonb));
end $$;

-- The tabs the sheet has right now ([{gid, name}] in sheet order). New tabs are added (synced when
-- "all tabs" is on), renamed tabs get their new name, and tabs no longer there are marked removed.
create or replace function public.sheet_sync_tabs_seen(p_token uuid, p_tabs jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sync public.sheet_sync := private.sheet_sync_require_run(p_token);
begin
  if jsonb_typeof(p_tabs) <> 'array' or jsonb_array_length(p_tabs) = 0 then
    raise exception using errcode = 'CR422', message = 'The sheet has no tabs.';
  end if;
  insert into public.sheet_sync_tabs (gid, name, position, enabled)
  select t->>'gid', left(t->>'name', 200), (ord - 1)::int, v_sync.all_tabs
    from jsonb_array_elements(p_tabs) with ordinality as x(t, ord)
  on conflict (gid) do update
     set name = excluded.name, position = excluded.position, removed = false,
         enabled = public.sheet_sync_tabs.enabled or v_sync.all_tabs,
         updated_at = now();
  update public.sheet_sync_tabs
     set removed = true, updated_at = now()
   where not removed and gid not in (select t->>'gid' from jsonb_array_elements(p_tabs) t);
  return private.sheet_sync_tabs_json();
end $$;

-- Saves how far through one tab this run got, once its rows are safely staged.
drop function public.sheet_sync_checkpoint(uuid, text, int, text, boolean);
create function public.sheet_sync_checkpoint(
  p_token uuid, p_gid text, p_content_hash text, p_processed_through_row int, p_prefix_hash text, p_has_more boolean
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.sheet_sync_require_run(p_token);
  update public.sheet_sync_tabs
     set content_hash = p_content_hash, processed_through_row = greatest(0, p_processed_through_row),
         prefix_hash = p_prefix_hash, has_more = coalesce(p_has_more, false), updated_at = now()
   where gid = p_gid;
  if not found then
    raise exception using errcode = 'CR404', message = 'That tab isn''t part of the sync.';
  end if;
end $$;

-- Records one tab's result in this run and returns its counts (from the batches staged for it).
create or replace function public.sheet_sync_tab_finish(p_token uuid, p_gid text, p_status text, p_error text, p_batch_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ok boolean := p_status in ('ok', 'unchanged');
  v_tab public.sheet_sync_tabs;
begin
  perform private.sheet_sync_require_run(p_token);
  if p_status not in ('ok', 'unchanged', 'error') then
    raise exception using errcode = 'CR422', message = 'Unknown sync status.';
  end if;
  update public.sheet_sync_tabs t set
    last_checked_at = now(), updated_at = now(), last_status = p_status,
    last_error = case when v_ok then null else left(coalesce(p_error, 'Sync failed.'), 500) end,
    last_synced_at = case when v_ok then now() else t.last_synced_at end,
    last_created = case when p_status = 'ok' then c.created else t.last_created end,
    last_skipped = case when p_status = 'ok' then c.skipped else t.last_skipped end,
    last_invalid = case when p_status = 'ok' then c.invalid else t.last_invalid end,
    last_batch_id = case when p_status = 'ok' and c.last_id is not null then c.last_id else t.last_batch_id end
  from (
    select coalesce(sum(b.created_count), 0)::int as created,
           coalesce(sum(b.skipped_count), 0)::int as skipped,
           coalesce(sum(b.invalid_count), 0)::int as invalid,
           (array_agg(b.id order by b.created_at desc))[1] as last_id
      from public.import_batches b
     where b.id = any (coalesce(p_batch_ids, '{}')) and b.origin = 'sheet_sync'
  ) c
  where t.gid = p_gid
  returning t.* into v_tab;
  return jsonb_build_object('created', coalesce(v_tab.last_created, 0), 'skipped', coalesce(v_tab.last_skipped, 0),
                            'invalid', coalesce(v_tab.last_invalid, 0));
end $$;

revoke all on function private.sheet_sync_tabs_json() from public, anon, authenticated;
revoke all on function
  public.sheet_sync_tabs_seen(uuid, jsonb), public.sheet_sync_checkpoint(uuid, text, text, int, text, boolean),
  public.sheet_sync_tab_finish(uuid, text, text, text, uuid[])
from public, anon, authenticated;
grant execute on function
  public.sheet_sync_tabs_seen(uuid, jsonb), public.sheet_sync_checkpoint(uuid, text, text, int, text, boolean),
  public.sheet_sync_tab_finish(uuid, text, text, text, uuid[])
to service_role;

-- ---------------------------------------------------------------------------
-- Settings from the app (signed-in admin or manager)
-- ---------------------------------------------------------------------------

create or replace function private.sheet_sync_settings_json() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'sheet_id', s.sheet_id,
    'all_tabs', s.all_tabs,
    'interval_minutes', s.interval_minutes,
    'enabled', s.enabled,
    -- pnpm sync:setup has installed the schedule (pg_cron + the secret in Vault).
    'scheduled', s.cron_secret_sha256 is not null,
    'actor_name', p.full_name,
    'tabs', private.sheet_sync_tabs_json())
  from public.sheet_sync s
  left join public.profiles p on p.id = s.actor_id
  where s.id = 1
$$;

create or replace function public.sheet_sync_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_manager();
  return private.sheet_sync_settings_json();
end $$;

-- Saves the sheet, which tabs to read and how often. p_tabs is the sheet's current tab list
-- ([{gid, name, enabled}] in sheet order). The person saving becomes the sync actor: synced imports
-- are recorded under them. A different sheet starts fresh; leads already in the CRM are still
-- recognised and skipped.
create or replace function public.sheet_sync_configure(
  p_sheet_id text, p_all_tabs boolean, p_tabs jsonb, p_interval_minutes int, p_enabled boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sync public.sheet_sync;
begin
  perform private.require_manager();
  if p_sheet_id is null or p_sheet_id !~ '^[A-Za-z0-9_-]{20,100}$' then
    raise exception using errcode = 'CR422', message = 'That isn''t a Google Sheets link.';
  end if;
  if p_interval_minutes is null or p_interval_minutes not in (5, 10, 15, 30, 60) then
    raise exception using errcode = 'CR422', message = 'Choose how often to sync: 5, 10, 15, 30 or 60 minutes.';
  end if;
  if jsonb_typeof(p_tabs) <> 'array' or exists (
       select 1 from jsonb_array_elements(p_tabs) t
        where coalesce(t->>'gid', '') !~ '^\d{1,12}$' or coalesce(btrim(t->>'name'), '') = '') then
    raise exception using errcode = 'CR422', message = 'The tab list is invalid. Load the tabs again.';
  end if;
  if coalesce(p_enabled, false) and not coalesce(p_all_tabs, false)
     and not exists (select 1 from jsonb_array_elements(p_tabs) t where (t->>'enabled')::boolean) then
    raise exception using errcode = 'CR422', message = 'Tick at least one tab to sync.';
  end if;

  select * into v_sync from public.sheet_sync where id = 1 for update;
  if v_sync.sheet_id is distinct from p_sheet_id then
    delete from public.sheet_sync_tabs;
    update public.sheet_sync
       set content_hash = null, prefix_hash = null, processed_through_row = 0, has_more = false,
           consecutive_failures = 0, last_status = 'never', last_error = null
     where id = 1;
  end if;

  insert into public.sheet_sync_tabs (gid, name, position, enabled)
  select t->>'gid', left(btrim(t->>'name'), 200), (ord - 1)::int,
         coalesce(p_all_tabs, false) or coalesce((t->>'enabled')::boolean, false)
    from jsonb_array_elements(p_tabs) with ordinality as x(t, ord)
  on conflict (gid) do update
     set name = excluded.name, position = excluded.position, enabled = excluded.enabled,
         removed = false, updated_at = now();
  update public.sheet_sync_tabs
     set removed = true, updated_at = now()
   where not removed and gid not in (select t->>'gid' from jsonb_array_elements(p_tabs) t);

  update public.sheet_sync
     set sheet_id = p_sheet_id, all_tabs = coalesce(p_all_tabs, false), interval_minutes = p_interval_minutes,
         enabled = coalesce(p_enabled, false), actor_id = auth.uid(), updated_at = now()
   where id = 1;
  return private.sheet_sync_settings_json();
end $$;

revoke all on function private.sheet_sync_settings_json() from public, anon, authenticated;
revoke all on function public.sheet_sync_settings(), public.sheet_sync_configure(text, boolean, jsonb, int, boolean)
  from public, anon;
grant execute on function public.sheet_sync_settings(), public.sheet_sync_configure(text, boolean, jsonb, int, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Schedule: every 5 minutes, calling the app only when the chosen interval has passed. Updates the
-- job pnpm sync:setup installed (same command as scripts/sync-setup.ts); nothing to do before then.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'crm-sheet-sync') then
    perform cron.schedule('crm-sheet-sync', '*/5 * * * *', $cmd$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sheet_sync_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sheet_sync_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
  where exists (
    select 1 from public.sheet_sync
     where id = 1 and enabled
       and (last_started_at is null
            or last_started_at <= now() - make_interval(mins => interval_minutes) + interval '1 minute'))$cmd$);
  end if;
end $$;
