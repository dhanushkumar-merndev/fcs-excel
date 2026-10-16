-- Staff sign in with a username and password; nothing is emailed.
-- Supabase Auth still keys logins by email, so profiles.email keeps the auth address: a real one
-- for older accounts, or <username>@fcs-staff.invalid (a reserved TLD that never receives mail).

alter table public.profiles add column username text;

-- Existing staff get the part of their email before the @, cleaned and made unique.
with cleaned as (
  select id, created_at,
         left(regexp_replace(regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]', '', 'g'), '^[^a-z0-9]+', ''), 28) as base
    from public.profiles
), padded as (
  select id, created_at,
         case when length(base) >= 3 then base else rpad(coalesce(nullif(base, ''), 'user'), 4, '0') end as base
    from cleaned
), numbered as (
  select id, base, row_number() over (partition by base order by created_at, id) as n from padded
)
update public.profiles p
   set username = case when numbered.n = 1 then numbered.base else numbered.base || numbered.n::text end
  from numbered
 where numbered.id = p.id;

alter table public.profiles
  alter column username set not null,
  add constraint profiles_username_format check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');
create unique index profiles_username_key on public.profiles (username);

comment on column public.profiles.username is 'Sign-in name: 3–32 of a-z, 0-9, dot, dash, underscore; starts with a letter or digit.';
comment on column public.profiles.email is 'Auth login address. Internal only; for username-only accounts it is <username>@fcs-staff.invalid.';
