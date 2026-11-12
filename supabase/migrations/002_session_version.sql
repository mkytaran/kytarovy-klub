alter table public.profiles
  add column if not exists auth_version integer not null default 1 check (auth_version > 0);

create unique index if not exists profiles_one_active_teacher_idx
  on public.profiles (role)
  where role = 'teacher' and active;

grant usage on schema public to service_role;
grant all privileges on table public.profiles, public.point_entries to service_role;
