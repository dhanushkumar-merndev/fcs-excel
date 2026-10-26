-- Keeps an app deployed before 20261026100000 syncing (one tab, as before) until the new app is
-- live: the claim also carries the old single-tab fields, and the old checkpoint signature still
-- exists. The current app ignores both.

create or replace function public.sheet_sync_claim(p_secret text, p_manual boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sync public.sheet_sync;
  v_tab public.sheet_sync_tabs;
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

  -- The tab the single-tab sync used.
  select * into v_tab from public.sheet_sync_tabs where gid = coalesce(v_sync.sheet_gid, '0');

  return jsonb_build_object(
    'claimed', true,
    'token', v_sync.run_token,
    'sheet_id', v_sync.sheet_id,
    'all_tabs', v_sync.all_tabs,
    'tabs', private.sheet_sync_tabs_json(),
    'pending_batch_ids', coalesce((
      select jsonb_agg(b.id order by b.created_at)
        from public.import_batches b
       where b.origin = 'sheet_sync' and b.status in ('ready', 'processing')), '[]'::jsonb),
    -- Single-tab fields for an app deployed before 20261026100000.
    'sheet_gid', v_sync.sheet_gid,
    'content_hash', v_tab.content_hash,
    'processed_through_row', coalesce(v_tab.processed_through_row, 0),
    'prefix_hash', v_tab.prefix_hash,
    'has_more', coalesce(v_tab.has_more, false));
end $$;

create function public.sheet_sync_checkpoint(
  p_token uuid, p_content_hash text, p_processed_through_row int, p_prefix_hash text, p_has_more boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_sync public.sheet_sync := private.sheet_sync_require_run(p_token);
begin
  update public.sheet_sync_tabs
     set content_hash = p_content_hash, processed_through_row = greatest(0, p_processed_through_row),
         prefix_hash = p_prefix_hash, has_more = coalesce(p_has_more, false), updated_at = now()
   where gid = coalesce(v_sync.sheet_gid, '0');
end $$;

revoke all on function public.sheet_sync_checkpoint(uuid, text, int, text, boolean) from public, anon, authenticated;
grant execute on function public.sheet_sync_checkpoint(uuid, text, int, text, boolean) to service_role;
