create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  normalized_name text not null,
  role text not null check (role in ('teacher', 'student')),
  avatar text not null default 'cat' check (avatar in (
    'cat', 'dog', 'rabbit', 'bear', 'lion', 'tiger', 'fox', 'wolf', 'mouse', 'hamster',
    'squirrel', 'hedgehog', 'raccoon', 'panda', 'koala', 'monkey', 'gorilla', 'elephant',
    'giraffe', 'zebra', 'horse', 'unicorn', 'cow', 'pig', 'sheep', 'goat', 'deer', 'bison',
    'camel', 'llama', 'kangaroo', 'sloth', 'otter', 'beaver', 'seal', 'dolphin', 'whale',
    'orca', 'shark', 'octopus', 'guitar'
  )),
  avatar_chosen boolean not null default false,
  active boolean not null default true,
  auth_version integer not null default 1 check (auth_version > 0),
  lesson_day text not null default '' check (lesson_day in (
    '', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
  )),
  created_at timestamptz not null default now()
);

create unique index profiles_active_normalized_name_key
  on public.profiles (normalized_name)
  where active;

create unique index profiles_one_active_teacher_idx
  on public.profiles (role)
  where role = 'teacher' and active;

create table public.point_entries (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id),
  student_name text not null,
  score smallint not null check (score between 1 and 10),
  point_date date not null,
  created_at timestamptz not null default now(),
  entry_type text not null default 'lesson' check (entry_type in ('lesson', 'extra')),
  reason text not null default '' check (
    (entry_type = 'lesson' and reason = '')
    or (entry_type = 'extra' and char_length(reason) between 2 and 120)
  )
);

create index point_entries_student_date_idx
  on public.point_entries (student_id, point_date desc, created_at desc);

create unique index point_entries_one_lesson_per_week_idx
  on public.point_entries (
    student_id,
    (point_date - (extract(isodow from point_date)::integer - 1))
  )
  where entry_type = 'lesson';

create or replace function public.is_active_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'teacher'
      and active
  );
$$;

revoke all on function public.is_active_teacher() from public;
grant execute on function public.is_active_teacher() to authenticated;

alter table public.profiles enable row level security;
alter table public.point_entries enable row level security;

grant select on public.profiles, public.point_entries to authenticated;
revoke insert, update, delete on public.profiles, public.point_entries from anon, authenticated;
grant all privileges on table public.profiles, public.point_entries to service_role;

create policy "Users can view active student profiles and their own profile"
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or (role = 'student' and active)
  );

create policy "Users can view their own entries and teachers can view all entries"
  on public.point_entries
  for select
  to authenticated
  using (
    student_id = (select auth.uid())
    or (select public.is_active_teacher())
  );
