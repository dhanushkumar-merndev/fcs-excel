-- Deleting a team member archives them instead of removing the row: calls, notes, follow-ups,
-- imports and lead history keep pointing at the profile (and its name). The username and login
-- address are released so they can be given to someone new.
alter table public.profiles add column deleted_at timestamptz;

comment on column public.profiles.deleted_at is 'Set when an admin deletes the member. Hidden from the team; history keeps the name.';

create or replace function public.admin_delete_staff(p_request_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb := private.claim_request(p_request_id, 'admin_delete_staff');
  v_old public.profiles;
  v_open_leads bigint;
  v_follow_ups bigint;
  v_username text;
  v_email text;
begin
  if v_replay is not null then return v_replay; end if;
  perform private.require_admin();
  if p_user_id = auth.uid() then
    raise exception using errcode = 'CR422', message = 'You can''t delete your own account.';
  end if;
  select * into v_old from public.profiles where id = p_user_id for update;
  if not found then
    raise exception using errcode = 'CR404', message = 'Team member not found.';
  end if;
  -- Already deleted: hand back the login address so the caller can finish closing the login.
  if v_old.deleted_at is not null then
    return private.finish_request(p_request_id, jsonb_build_object('email', v_old.email));
  end if;

  -- Don't strand work on someone nobody can see any more. Both counts are index-backed.
  select count(*) into v_open_leads from public.leads
   where owner_id = p_user_id and stage not in ('booked', 'lost', 'unqualified');
  select count(*) into v_follow_ups from public.follow_ups
   where assignee_id = p_user_id and status = 'pending';
  if v_open_leads > 0 or v_follow_ups > 0 then
    raise exception using errcode = 'CR409', message = format('Reassign %s''s %s before deleting them.',
      v_old.full_name,
      concat_ws(' and ',
        case when v_open_leads > 0 then v_open_leads || case when v_open_leads = 1 then ' open lead' else ' open leads' end end,
        case when v_follow_ups > 0 then v_follow_ups || case when v_follow_ups = 1 then ' pending follow-up' else ' pending follow-ups' end end));
  end if;

  v_username := 'deleted-' || right(replace(p_user_id::text, '-', ''), 24);
  v_email := v_username || '@fcs-staff.invalid';
  -- protect_last_admin still fires on this update.
  update public.profiles
     set is_active = false,
         deactivated_at = coalesce(deactivated_at, now()),
         deleted_at = now(),
         username = v_username,
         email = v_email
   where id = p_user_id;

  perform private.audit('staff_deleted', 'profile', p_user_id::text,
    jsonb_build_object('name', v_old.full_name, 'username', v_old.username, 'role', v_old.role));
  return private.finish_request(p_request_id, jsonb_build_object('email', v_email));
end $$;

revoke all on function public.admin_delete_staff(uuid, uuid) from public, anon;
grant execute on function public.admin_delete_staff(uuid, uuid) to authenticated;
