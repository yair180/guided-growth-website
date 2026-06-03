-- ============================================================
--   Guided Growth — Founding Users (50) intake
--   Run this in the Supabase SQL editor (or via migration).
--   Mirrors the waitlist_signups RLS pattern: anon INSERT only.
-- ============================================================

create extension if not exists "pgcrypto";

create table if not exists public.founding_signups (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),

  -- Identity + bridge key to the app
  email           text not null unique,
  first_name      text,

  -- Attribution (replaces the in-app referral field for founding users)
  heard_from       text,        -- founder_invite | friend
  referred_by_name text,        -- the friend's name when heard_from = 'friend' (required in the UI)

  -- Behavioral signal (the rich part)
  track_level     text,        -- none | casual | serious   (drives beginner vs advanced)
  apps_used       text[],      -- e.g. {notion,habit_tracker,journaling}
  apps_other      text,        -- free text when they pick "Other"
  pays_for_apps   text,        -- none | one | several

  -- Light demographics
  age             smallint,    -- typed age (founding users enter a number)
  gender          text,        -- male | female | other

  -- Optional baseline outcome metric (the "before" number)
  baseline_score  smallint,    -- 1..10, nullable (skippable)

  -- Derived routing + commitment
  derived_path    text,        -- beginner | advanced  (computed client-side, re-derivable from raw)
  two_week_commit boolean not null default false,
  commit_ts       timestamptz,

  -- Lifecycle
  status          text not null default 'signed_up',  -- signed_up | invited | activated | churned
  cohort          text not null default 'founding-50',
  linked_user_id  uuid,        -- set by the bridge when they create their app account

  -- Provenance
  referrer        text,
  user_agent      text
);

-- Defense in depth: sane email shape + bounded enums at the DB layer.
alter table public.founding_signups
  add constraint founding_email_format
  check (email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$');

alter table public.founding_signups
  add constraint founding_baseline_range
  check (baseline_score is null or (baseline_score between 1 and 10));

alter table public.founding_signups
  add constraint founding_age_range
  check (age is null or (age between 13 and 120));

-- ---- Row Level Security: anon can INSERT only. No read / update / delete. ----
alter table public.founding_signups enable row level security;

create policy "anon can insert founding signup"
  on public.founding_signups
  for insert
  to anon
  with check (true);

-- ============================================================
--   Hard cap at 50 active spots (the "50" is a promise).
--   Counts non-churned rows. Small race window is acceptable at this scale.
-- ============================================================
create or replace function public.founding_enforce_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  taken int;
begin
  select count(*) into taken
  from public.founding_signups
  where status <> 'churned';

  if taken >= 50 then
    raise exception 'FOUNDING_FULL' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_founding_cap on public.founding_signups;
create trigger trg_founding_cap
  before insert on public.founding_signups
  for each row execute function public.founding_enforce_cap();

-- ============================================================
--   Public RPC: how many of the 50 spots are left.
--   Lets the page show the counter + flip to the waitlist at 0
--   WITHOUT exposing any row data to anon.
-- ============================================================
create or replace function public.founding_spots_remaining()
returns int
language sql
security definer
set search_path = public
as $$
  select greatest(0, 50 - (
    select count(*)::int from public.founding_signups where status <> 'churned'
  ));
$$;

grant execute on function public.founding_spots_remaining() to anon;

-- ============================================================
--   Bridge read: the app fetches a founding user's intake by email
--   AFTER they create their account, then copies it into profiles
--   and sets onboarding_path so the standard intake is skipped.
--
--   Self-gated: an authenticated user can only read the row whose
--   email matches their own auth email. No cross-user leakage.
--
--   NOTE: this assumes the app and the website share this Supabase
--   project. If they are separate projects, the app instead calls
--   this project's RPC with a service key (see supabase/README.md).
-- ============================================================
create or replace function public.get_founding_intake()
returns public.founding_signups
language sql
security definer
set search_path = public
as $$
  select *
  from public.founding_signups
  where lower(email) = lower(auth.jwt() ->> 'email')
  limit 1;
$$;

grant execute on function public.get_founding_intake() to authenticated;

-- After the app has copied the intake into its own profiles row, it marks
-- the founding signup activated and links the user id. Self-gated the same way.
create or replace function public.mark_founding_activated(p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.founding_signups
     set status = 'activated',
         linked_user_id = p_user_id
   where lower(email) = lower(auth.jwt() ->> 'email');
$$;

grant execute on function public.mark_founding_activated(uuid) to authenticated;
-- ============================================================
