-- Waitlist signups for guidedgrowthos.com
--
-- The marketing site POSTs directly to PostgREST as the anon role.
-- RLS allows INSERT only. Reads + updates + deletes are blocked at the
-- anon layer; use the service-role key (server-side) for review/export.

create table if not exists public.waitlist_signups (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  source      text,                                 -- 'hero' | 'waitlist-section' | future
  referrer    text,                                 -- document.referrer at submit time
  user_agent  text,
  created_at  timestamptz not null default now(),
  unique (email)
);

create index if not exists waitlist_signups_created_at_idx
  on public.waitlist_signups (created_at desc);

alter table public.waitlist_signups enable row level security;

-- Anon can INSERT only. No select / update / delete from the public web.
drop policy if exists "anon can insert waitlist signups" on public.waitlist_signups;
create policy "anon can insert waitlist signups"
  on public.waitlist_signups
  for insert
  to anon
  with check (
    email is not null
    and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and length(email) <= 320
    and (source is null or length(source) <= 40)
    and (referrer is null or length(referrer) <= 500)
    and (user_agent is null or length(user_agent) <= 500)
  );
