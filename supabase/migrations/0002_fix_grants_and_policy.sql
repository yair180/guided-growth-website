-- One-shot fix: reset grants + policy so signups work end-to-end.
-- After running, paste the result table back to Claude.

-- 1. Drop any existing policies on the table
do $$ declare r record;
begin
  for r in select polname from pg_policy where polrelid = 'public.waitlist_signups'::regclass
  loop execute format('drop policy %I on public.waitlist_signups', r.polname); end loop;
end$$;

-- 2. Reset grants from scratch
revoke all on public.waitlist_signups from public, anon, authenticated, service_role;

-- 3. Grant each role what it actually needs:
--    - service_role: full access (for Claude to verify/manage from outside)
--    - anon: INSERT only (the marketing site form). NO select, so emails can't be scraped.
grant select, insert, update, delete on public.waitlist_signups to service_role;
grant insert on public.waitlist_signups to anon;

-- 4. Make sure RLS is on
alter table public.waitlist_signups enable row level security;

-- 5. Single permissive policy: anon can insert if email looks plausible.
--    Regex moved client-side; DB just enforces length bounds + NOT NULL + UNIQUE.
create policy "anon_insert" on public.waitlist_signups
  for insert to anon
  with check (
    email is not null
    and length(email) between 3 and 320
    and (source is null or length(source) <= 40)
    and (referrer is null or length(referrer) <= 500)
    and (user_agent is null or length(user_agent) <= 500)
  );

-- 6. Force PostgREST to reload its schema cache so the new policy takes effect immediately.
notify pgrst, 'reload schema';

-- 7. Confirmation — paste this result back to Claude.
select 'policy' as kind, polname as name, polcmd::text as detail,
       pg_get_expr(polwithcheck, polrelid) as expr
from pg_policy where polrelid = 'public.waitlist_signups'::regclass
union all
select 'grant', grantee, privilege_type, null
from information_schema.role_table_grants
where table_name = 'waitlist_signups' and grantee in ('anon','authenticated','service_role')
order by 1, 2, 3;
