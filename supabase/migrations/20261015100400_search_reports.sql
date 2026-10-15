-- Search, dashboards and reports. All SECURITY INVOKER so Row Level Security scopes every
-- number to what the caller may see. search_leads is the single filter definition shared by
-- lists, drill-downs, exports and report cohorts, so totals reconcile by construction.

create or replace function private.ist_day_start(p_day text) returns timestamptz
language sql immutable set search_path = '' as $$
  select case when nullif(p_day, '') is null then null
              else (p_day::date)::timestamp at time zone 'Asia/Kolkata' end
$$;

create or replace function private.ist_day_end(p_day text) returns timestamptz
language sql immutable set search_path = '' as $$
  select case when nullif(p_day, '') is null then null
              else (p_day::date + 1)::timestamp at time zone 'Asia/Kolkata' end
$$;

create or replace function private.jsonb_text_array(p jsonb) returns text[]
language sql immutable set search_path = '' as $$
  select case when p is null or jsonb_typeof(p) <> 'array' then null
              else array(select jsonb_array_elements_text(p)) end
$$;

create or replace function private.like_pattern(p text) returns text
language sql immutable set search_path = '' as $$
  select '%' || replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_') || '%'
$$;

grant execute on function private.ist_day_start(text), private.ist_day_end(text),
  private.jsonb_text_array(jsonb), private.like_pattern(text) to authenticated;

/*
  Filter keys (all optional):
    q, owner[] ('me' | 'unassigned' | uuid), stage[], stage_group ('open'|'closed'),
    platform[], campaign[], ad[], occasion[], menu[], priority[], event_status[],
    event_from/event_to (date), acquired_from/acquired_to (IST date, original creation),
    imported_from/imported_to (IST date, CRM entry), closed_from/closed_to (IST date),
    follow_up ('overdue'|'today'|'upcoming'|'none'|'due'), review (bool), no_contact (bool),
    import_batch (uuid), ids[] (uuid), assigned_since (timestamptz), phone (E.164),
    activity {type: call|dial|follow_up_completed|booked, outcome?, from?, to?, actor?}
*/
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

-- Distinct values for filter dropdowns (scoped by RLS).
create or replace function public.lead_filter_options()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'campaigns', coalesce((select jsonb_agg(v order by v) from (select distinct campaign_name v from public.leads where campaign_name is not null) x), '[]'),
    'ads', coalesce((select jsonb_agg(v order by v) from (select distinct ad_name v from public.leads where ad_name is not null) x), '[]'),
    'platforms', coalesce((select jsonb_agg(v order by v) from (select distinct platform v from public.leads where platform is not null) x), '[]'),
    'occasions', coalesce((select jsonb_agg(v order by v) from (select distinct occasion_code v from public.leads where occasion_code is not null) x), '[]'),
    'menus', coalesce((select jsonb_agg(v order by v) from (select distinct menu_code v from public.leads where menu_code is not null) x), '[]')
  )
$$;

create or replace function public.team_workload()
returns table (
  id uuid, full_name text, role text, is_active boolean,
  open_leads bigint, overdue_follow_ups bigint, due_today bigint, assigned_last_7_days bigint
) language sql stable security invoker set search_path = '' as $$
  with bounds as (
    select ((now() at time zone 'Asia/Kolkata')::date + 1)::timestamp at time zone 'Asia/Kolkata' as today_end
  )
  select p.id, p.full_name, p.role, p.is_active,
    (select count(*) from public.leads l where l.owner_id = p.id and l.stage not in ('booked', 'lost', 'unqualified')),
    (select count(*) from public.follow_ups f where f.assignee_id = p.id and f.status = 'pending' and f.due_at < now()),
    (select count(*) from public.follow_ups f, bounds b where f.assignee_id = p.id and f.status = 'pending'
       and f.due_at >= now() and f.due_at < b.today_end),
    (select count(*) from public.leads l where l.owner_id = p.id and l.assigned_at >= now() - interval '7 days')
  from public.profiles p
  where p.is_active
  order by case p.role when 'salesperson' then 0 when 'manager' then 1 else 2 end, p.full_name
$$;

create or replace function public.dashboard_summary()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_today_start timestamptz := ((now() at time zone 'Asia/Kolkata')::date)::timestamp at time zone 'Asia/Kolkata';
  v_today_end timestamptz := ((now() at time zone 'Asia/Kolkata')::date + 1)::timestamp at time zone 'Asia/Kolkata';
  v_result jsonb;
begin
  if private.staff_role() is null then
    raise exception using errcode = 'CR401', message = 'Your session is not active. Please sign in again.';
  end if;

  select jsonb_build_object(
    'new_today', count(*) filter (where created_at >= v_today_start),
    'new_7d', count(*) filter (where created_at >= v_today_start - interval '6 days'),
    'unassigned_open', count(*) filter (where owner_id is null and stage not in ('booked', 'lost', 'unqualified')),
    'open', count(*) filter (where stage not in ('booked', 'lost', 'unqualified')),
    'booked_30d', count(*) filter (where stage = 'booked' and closed_at >= v_today_start - interval '29 days'),
    'lost_30d', count(*) filter (where stage in ('lost', 'unqualified') and closed_at >= v_today_start - interval '29 days'),
    'needs_review', count(*) filter (where cardinality(review_flags) > 0 and stage not in ('booked', 'lost', 'unqualified')),
    'awaiting_first_contact', count(*) filter (where first_call_logged_at is null and stage not in ('booked', 'lost', 'unqualified')),
    'upcoming_events_7d', count(*) filter (where event_date between (now() at time zone 'Asia/Kolkata')::date
                                           and (now() at time zone 'Asia/Kolkata')::date + 7
                                           and stage not in ('lost', 'unqualified')),
    'by_stage', (select coalesce(jsonb_object_agg(stage, c), '{}') from
                  (select stage, count(*) c from public.leads group by stage) s)
  ) into v_result
  from public.leads;

  v_result := v_result || jsonb_build_object(
    'overdue_follow_ups', (select count(*) from public.follow_ups where status = 'pending' and due_at < now()),
    'due_today', (select count(*) from public.follow_ups where status = 'pending' and due_at >= now() and due_at < v_today_end),
    'my_overdue', (select count(*) from public.follow_ups where status = 'pending' and due_at < now() and assignee_id = auth.uid()),
    'my_due_today', (select count(*) from public.follow_ups where status = 'pending' and due_at >= now()
                       and due_at < v_today_end and assignee_id = auth.uid())
  );
  return v_result;
end $$;

-- Reports. Acquisition cohort = leads by original creation time (acquired_at). Activity =
-- events by their own timestamps within the same date range. Import time is reported separately.
create or replace function public.report_overview(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_from timestamptz := private.ist_day_start(p_filters->>'acquired_from');
  v_to timestamptz := private.ist_day_end(p_filters->>'acquired_to');
  v_actor text := (private.jsonb_text_array(p_filters->'owner'))[1];
  v_activity_filters jsonb := p_filters - 'acquired_from' - 'acquired_to' - 'owner' - 'stage' - 'stage_group';
  v_cohort jsonb;
  v_activity jsonb;
  v_snapshot jsonb;
begin
  if private.staff_role() is null then
    raise exception using errcode = 'CR401', message = 'Your session is not active. Please sign in again.';
  end if;
  if v_actor = 'me' then
    v_actor := auth.uid()::text;
  elsif v_actor = 'unassigned' then
    v_actor := null;
  end if;

  with cohort as materialized (select * from public.search_leads(p_filters))
  select jsonb_build_object(
    'total', (select count(*) from cohort),
    'booked', (select count(*) from cohort where stage = 'booked'),
    'lost', (select count(*) from cohort where stage = 'lost'),
    'unqualified', (select count(*) from cohort where stage = 'unqualified'),
    'open', (select count(*) from cohort where stage not in ('booked', 'lost', 'unqualified')),
    'assigned', (select count(*) from cohort where owner_id is not null),
    'unassigned', (select count(*) from cohort where owner_id is null),
    'with_logged_call', (select count(*) from cohort where first_call_logged_at is not null),
    'with_dial', (select count(*) from cohort where first_dial_at is not null),
    'median_hours_to_first_call', (select round((percentile_cont(0.5) within group (
        order by extract(epoch from first_call_logged_at - created_at) / 3600.0))::numeric, 1)
        from cohort where first_call_logged_at is not null),
    'p75_hours_to_first_call', (select round((percentile_cont(0.75) within group (
        order by extract(epoch from first_call_logged_at - created_at) / 3600.0))::numeric, 1)
        from cohort where first_call_logged_at is not null),
    'booking_value_total', (select sum(booking_value_inr) from cohort where stage = 'booked'),
    'booking_value_count', (select count(*) from cohort where stage = 'booked' and booking_value_inr is not null),
    'by_stage', (select coalesce(jsonb_agg(jsonb_build_object('stage', stage, 'leads', c) order by r), '[]')
                 from (select stage, min(stage_rank) r, count(*) c from cohort group by stage) s),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'leads', c, 'booked', b) order by d), '[]')
               from (select (acquired_at at time zone 'Asia/Kolkata')::date d, count(*) c,
                            count(*) filter (where stage = 'booked') b
                     from cohort group by 1) x),
    'by_campaign', (select coalesce(jsonb_agg(jsonb_build_object('value', v, 'leads', c, 'booked', b) order by c desc, v), '[]')
                    from (select coalesce(campaign_name, '') v, count(*) c, count(*) filter (where stage = 'booked') b
                          from cohort group by 1 order by 2 desc limit 50) x),
    'by_ad', (select coalesce(jsonb_agg(jsonb_build_object('value', v, 'leads', c, 'booked', b) order by c desc, v), '[]')
              from (select coalesce(ad_name, '') v, count(*) c, count(*) filter (where stage = 'booked') b
                    from cohort group by 1 order by 2 desc limit 50) x),
    'by_platform', (select coalesce(jsonb_agg(jsonb_build_object('value', v, 'leads', c, 'booked', b) order by c desc, v), '[]')
                    from (select coalesce(platform, '') v, count(*) c, count(*) filter (where stage = 'booked') b
                          from cohort group by 1) x),
    'by_occasion', (select coalesce(jsonb_agg(jsonb_build_object('value', v, 'leads', c, 'booked', b) order by c desc, v), '[]')
                    from (select coalesce(occasion_code, '') v, count(*) c, count(*) filter (where stage = 'booked') b
                          from cohort group by 1) x),
    'by_owner', (select coalesce(jsonb_agg(jsonb_build_object(
                    'owner_id', x.o, 'name', coalesce(p.full_name, 'Unassigned'), 'leads', x.c, 'open', x.op,
                    'booked', x.b, 'lost', x.lo) order by x.c desc), '[]')
                 from (select owner_id o, count(*) c,
                              count(*) filter (where stage not in ('booked', 'lost', 'unqualified')) op,
                              count(*) filter (where stage = 'booked') b,
                              count(*) filter (where stage in ('lost', 'unqualified')) lo
                       from cohort group by owner_id) x
                 left join public.profiles p on p.id = x.o),
    'ageing', (select jsonb_build_object(
                  '0_2', count(*) filter (where age < 3),
                  '3_7', count(*) filter (where age between 3 and 7),
                  '8_14', count(*) filter (where age between 8 and 14),
                  '15_30', count(*) filter (where age between 15 and 30),
                  '31_plus', count(*) filter (where age > 30))
               from (select ((now() at time zone 'Asia/Kolkata')::date - (acquired_at at time zone 'Asia/Kolkata')::date) age
                     from cohort where stage not in ('booked', 'lost', 'unqualified')) a)
  ) into v_cohort;

  -- Activity in the date range (by when the activity happened), on leads matching the
  -- non-date, non-owner filters; the salesperson filter applies to who performed it.
  select jsonb_build_object(
    'calls_by_outcome', (select coalesce(jsonb_agg(jsonb_build_object('outcome', outcome, 'calls', c, 'leads', ld) order by c desc), '[]')
                         from (select c.outcome, count(*) c, count(distinct c.lead_id) ld
                               from public.call_logs c
                               where (v_from is null or c.called_at >= v_from) and (v_to is null or c.called_at < v_to)
                                 and (v_actor is null or c.caller_id::text = v_actor)
                                 and c.lead_id in (select id from public.search_leads(v_activity_filters))
                               group by c.outcome) x),
    'dial_taps', (select count(*) from public.lead_events e
                  where e.event_type = 'dial_requested'
                    and (v_from is null or e.created_at >= v_from) and (v_to is null or e.created_at < v_to)
                    and (v_actor is null or e.actor_id::text = v_actor)
                    and e.lead_id in (select id from public.search_leads(v_activity_filters))),
    'follow_ups_completed', (select count(*) from public.follow_ups f
                  where f.status = 'completed'
                    and (v_from is null or f.completed_at >= v_from) and (v_to is null or f.completed_at < v_to)
                    and (v_actor is null or f.completed_by::text = v_actor)
                    and f.lead_id in (select id from public.search_leads(v_activity_filters))),
    'follow_ups_created', (select count(*) from public.follow_ups f
                  where (v_from is null or f.created_at >= v_from) and (v_to is null or f.created_at < v_to)
                    and (v_actor is null or f.assignee_id::text = v_actor)
                    and f.lead_id in (select id from public.search_leads(v_activity_filters))),
    'booked_in_period', (select count(distinct e.lead_id) from public.lead_events e
                  where e.event_type = 'stage_changed' and e.payload->>'to' = 'booked'
                    and (v_from is null or e.created_at >= v_from) and (v_to is null or e.created_at < v_to)
                    and (v_actor is null or e.actor_id::text = v_actor)
                    and e.lead_id in (select id from public.search_leads(v_activity_filters))),
    'lost_in_period', (select count(distinct e.lead_id) from public.lead_events e
                  where e.event_type = 'stage_changed' and e.payload->>'to' in ('lost', 'unqualified')
                    and (v_from is null or e.created_at >= v_from) and (v_to is null or e.created_at < v_to)
                    and (v_actor is null or e.actor_id::text = v_actor)
                    and e.lead_id in (select id from public.search_leads(v_activity_filters))),
    'imported_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'leads', c) order by d), '[]')
                  from (select (l.created_at at time zone 'Asia/Kolkata')::date d, count(*) c
                        from public.search_leads(v_activity_filters || jsonb_strip_nulls(jsonb_build_object(
                               'imported_from', p_filters->>'acquired_from', 'imported_to', p_filters->>'acquired_to'))) l
                        where l.source_system = 'meta_lead_ads'
                        group by 1) x)
  ) into v_activity;

  -- Current snapshot (not date-bound).
  select jsonb_build_object(
    'overdue_follow_ups', (select count(*) from public.follow_ups f
                           where f.status = 'pending' and f.due_at < now()
                             and (v_actor is null or f.assignee_id::text = v_actor)
                             and f.lead_id in (select id from public.search_leads(v_activity_filters))),
    'upcoming_events_7d', (select count(*) from public.search_leads(v_activity_filters) l
                           where l.event_date between (now() at time zone 'Asia/Kolkata')::date
                                 and (now() at time zone 'Asia/Kolkata')::date + 7
                             and l.stage not in ('lost', 'unqualified')
                             and (v_actor is null or l.owner_id::text = v_actor)),
    'upcoming_events_30d', (select count(*) from public.search_leads(v_activity_filters) l
                           where l.event_date between (now() at time zone 'Asia/Kolkata')::date
                                 and (now() at time zone 'Asia/Kolkata')::date + 30
                             and l.stage not in ('lost', 'unqualified')
                             and (v_actor is null or l.owner_id::text = v_actor)),
    'unassigned_open', (select count(*) from public.search_leads(v_activity_filters) l
                        where l.owner_id is null and l.stage not in ('booked', 'lost', 'unqualified'))
  ) into v_snapshot;

  return jsonb_build_object('cohort', v_cohort, 'activity', v_activity, 'snapshot', v_snapshot,
                            'generated_at', now());
end $$;
