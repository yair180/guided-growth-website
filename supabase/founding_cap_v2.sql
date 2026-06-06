-- ============================================================
--   Founding Users — list-based, changeable cap (v2)
--   Run this ONCE in the Supabase SQL editor (project pmunbflbjpoawicgimyc).
--   Safe on the existing live table. Idempotent (re-runnable).
--
--   What it gives you:
--     • An explicit founders LIST (is_founder flag + founder_number order),
--       not a magic row count.
--     • A changeable CAP that lives in a config table, not in code.
--     • Accurate admission under concurrency (advisory lock).
--     • Leaving never deletes anything: free a slot by flipping is_founder,
--       the person's row and their app account stay.
-- ============================================================

-- 1) The cap as a setting (single-row config table) -----------
create table if not exists public.founding_config (
  id         int primary key default 1,
  cap        int not null default 50,
  updated_at timestamptz not null default now(),
  constraint founding_config_singleton check (id = 1)
);
insert into public.founding_config (id, cap) values (1, 50)
  on conflict (id) do nothing;

alter table public.founding_config enable row level security;
-- No anon/authenticated policies on purpose: only you (dashboard/owner)
-- can read or change the cap. The functions below read it as definer.

-- 2) The founder list: explicit flag + admission order --------
alter table public.founding_signups
  add column if not exists is_founder     boolean not null default true,
  add column if not exists founder_number int;

create unique index if not exists founding_number_uq
  on public.founding_signups(founder_number)
  where founder_number is not null;

-- Backfill any existing rows in signup order (continues after current max).
with ordered as (
  select id,
         coalesce((select max(founder_number) from public.founding_signups), 0)
           + row_number() over (order by created_at, id) as rn
    from public.founding_signups
   where founder_number is null
)
update public.founding_signups f
   set founder_number = o.rn,
       is_founder = true
  from ordered o
 where f.id = o.id;

-- 3) Cap enforcement: read cap from config, count the founder list,
--    assign the next number, serialize admissions with an advisory lock.
create or replace function public.founding_enforce_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cap_val int;
  taken   int;
begin
  perform pg_advisory_xact_lock(778899);            -- serialize so two people can't both grab the last slot
  select cap into cap_val from public.founding_config where id = 1;
  select count(*) into taken from public.founding_signups where is_founder = true;
  if taken >= cap_val then
    raise exception 'FOUNDING_FULL' using errcode = 'check_violation';
  end if;
  new.is_founder := true;
  select coalesce(max(founder_number), 0) + 1
    into new.founder_number
    from public.founding_signups;
  return new;
end;
$$;

drop trigger if exists trg_founding_cap on public.founding_signups;
create trigger trg_founding_cap
  before insert on public.founding_signups
  for each row execute function public.founding_enforce_cap();

-- 4) Spots remaining = cap (from config) − active founders -----
create or replace function public.founding_spots_remaining()
returns int
language sql
security definer
set search_path = public
as $$
  select greatest(0,
    (select cap from public.founding_config where id = 1)
    - (select count(*) from public.founding_signups where is_founder = true)
  );
$$;

grant execute on function public.founding_spots_remaining() to anon;

-- ============================================================
--   Everyday controls (run any time, from the SQL editor):
--
--   Open more spots:
--     update public.founding_config set cap = 75, updated_at = now();
--
--   Free a slot (keeps their row AND their app account):
--     update public.founding_signups set is_founder = false where email = 'someone@example.com';
--
--   See the founders list, in order:
--     select founder_number, first_name, last_name, email, status, is_founder
--       from public.founding_signups where is_founder order by founder_number;
--
--   How many are left:
--     select public.founding_spots_remaining();
-- ============================================================
