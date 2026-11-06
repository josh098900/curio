-- The health check's function (spec §14.3). The daily job and the web app's health route call
-- it through the Data API without signing in, so it has to work for anon.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

select ok(
  has_function_privilege('anon', 'public.health()', 'execute'),
  'DB-HLT-01 anon can run public.health()'
);

select is(public.health(), true, 'DB-HLT-01 public.health() returns true');

select * from finish();
rollback;
