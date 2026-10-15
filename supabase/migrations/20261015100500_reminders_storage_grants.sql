-- Server-side follow-up reminders (pg_cron), import file storage, realtime, function grants.

create or replace function private.generate_follow_up_reminders() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_lead_minutes int;
  v_due int := 0;
  v_overdue int := 0;
  v_row record;
begin
  select reminder_lead_minutes into v_lead_minutes from public.business_settings where id = 1;
  v_lead_minutes := coalesce(v_lead_minutes, 15);

  -- Due soon: one reminder before the due time.
  for v_row in
    select f.id, f.lead_id, f.assignee_id, f.due_at, f.purpose, l.customer_name
    from public.follow_ups f
    join public.leads l on l.id = f.lead_id
    join public.profiles p on p.id = f.assignee_id and p.is_active
    where f.status = 'pending' and f.reminder_sent_at is null
      and f.due_at >= now() and f.due_at <= now() + make_interval(mins => v_lead_minutes)
    for update of f skip locked
  loop
    perform private.notify(v_row.assignee_id, 'follow_up_due',
      'Follow-up due ' || to_char(v_row.due_at at time zone 'Asia/Kolkata', 'HH12:MI AM') || ': ' || v_row.customer_name,
      v_row.purpose, '/leads/' || v_row.lead_id, v_row.lead_id, v_row.id, null,
      'fu_due:' || v_row.id || ':' || extract(epoch from v_row.due_at)::bigint);
    update public.follow_ups set reminder_sent_at = now() where id = v_row.id;
    v_due := v_due + 1;
  end loop;

  -- Overdue: one notification once the due time has passed (badges persist until resolved).
  for v_row in
    select f.id, f.lead_id, f.assignee_id, f.due_at, f.purpose, l.customer_name
    from public.follow_ups f
    join public.leads l on l.id = f.lead_id
    join public.profiles p on p.id = f.assignee_id and p.is_active
    where f.status = 'pending' and f.overdue_notified_at is null and f.due_at < now()
    for update of f skip locked
  loop
    perform private.notify(v_row.assignee_id, 'follow_up_overdue',
      'Overdue follow-up: ' || v_row.customer_name,
      v_row.purpose || ' — was due ' || private.ist_label(v_row.due_at),
      '/leads/' || v_row.lead_id, v_row.lead_id, v_row.id, null,
      'fu_overdue:' || v_row.id || ':' || extract(epoch from v_row.due_at)::bigint);
    update public.follow_ups
       set overdue_notified_at = now(), reminder_sent_at = coalesce(reminder_sent_at, now())
     where id = v_row.id;
    v_overdue := v_overdue + 1;
  end loop;

  return jsonb_build_object('due', v_due, 'overdue', v_overdue);
end $$;

create or replace function private.cleanup_request_log() returns void
language sql security definer set search_path = '' as $$
  delete from private.request_log where created_at < now() - interval '14 days';
$$;

select cron.schedule('crm-follow-up-reminders', '* * * * *', 'select private.generate_follow_up_reminders()');
select cron.schedule('crm-request-log-cleanup', '17 3 * * *', 'select private.cleanup_request_log()');

-- Original import files: private bucket, accessed only through the server after role checks.
insert into storage.buckets (id, name, public, file_size_limit)
values ('import-files', 'import-files', false, 10485760)
on conflict (id) do nothing;

-- Live notification badge.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Function grants: public RPCs callable by signed-in users only (each checks role inside).
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.staff_role(), private.is_staff(), private.is_admin(),
  private.is_manager_or_admin(), private.can_access_lead(uuid),
  private.ist_day_start(text), private.ist_day_end(text),
  private.jsonb_text_array(jsonb), private.like_pattern(text)
to authenticated;
