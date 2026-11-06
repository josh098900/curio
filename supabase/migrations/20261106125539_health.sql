-- The health check (spec §14.3). The daily job and the web app's health route call this through
-- the Data API without signing in, to show the database answers, which also keeps the free
-- projects from pausing. It reads nothing, and it's the one function anon can run (spec §9,
-- DB-SCH-02, DB-HLT-01).
create function public.health() returns boolean
  language sql stable
begin atomic
  select true;
end;

grant execute on function public.health() to anon;
