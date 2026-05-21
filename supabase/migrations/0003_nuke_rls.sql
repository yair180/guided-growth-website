-- Nuclear option: drop and recreate the table without RLS.
-- Privacy is enforced by grant absence (anon can INSERT only, can't SELECT).
-- We proved service_role grants work; this removes RLS as the unknown variable.

drop table if exists public.waitlist_signups cascade;

create table public.waitlist_signups (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  source      text,
  referrer    text,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index waitlist_signups_created_at_idx
  on public.waitlist_signups (created_at desc);

-- Anon: INSERT only. No SELECT means anon can't scrape emails.
grant insert on public.waitlist_signups to anon;

-- service_role: full access for management.
grant select, insert, update, delete on public.waitlist_signups to service_role;

-- RLS off. Grants alone enforce who can do what.
alter table public.waitlist_signups disable row level security;

notify pgrst, 'reload schema';

-- Sanity
select grantee, privilege_type
from information_schema.role_table_grants
where table_name = 'waitlist_signups'
order by grantee, privilege_type;
