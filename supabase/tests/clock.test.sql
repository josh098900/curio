-- The test clock (spec §11, test specification §1). private.now() honours curio.test_now only on
-- a database whose comment seed.sql set to 'curio:test-clock'. The hosted projects never run the
-- seed, so this test removes the mark inside its transaction to stand in for them.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select is(
  shobj_description((select oid from pg_database where datname = current_database()), 'pg_database'),
  'curio:test-clock',
  'DB-CLK-01 this database carries the test-clock mark from seed.sql'
);

select set_config('curio.test_now', '2027-01-10 18:00:00+00', true);
select is(
  private.now(), '2027-01-10 18:00:00+00'::timestamptz,
  'DB-CLK-01 the marked database honours curio.test_now'
);

select set_config('curio.test_now', '', true);
select is(private.now(), now(), 'DB-CLK-01 with nothing set, the real time');

-- As on the hosted projects: no mark.
comment on database postgres is null;
select set_config('curio.test_now', '2027-01-10 18:00:00+00', true);
select is(
  private.now(), now(),
  'DB-CLK-01 without the mark, as on the hosted projects, curio.test_now has no effect'
);

-- A session with a direct connection can set curio.test_now itself (no request can), but a
-- client role can't add the mark, so on an unmarked database the setting stays without effect.
set local role authenticated;
select set_config('curio.test_now', '2027-01-10 18:00:00+00', true);
select throws_ok(
  $$ comment on database postgres is 'curio:test-clock' $$,
  '42501',
  null,
  'DB-CLK-01 a client role can''t add the mark'
);
reset role;
select is(private.now(), now(), 'DB-CLK-01 so a client role''s curio.test_now has no effect');

-- Only the database's owner can change its comment, so no role the Data API, Realtime or
-- Storage acts as may own it or be a member of its owner.
select is_empty(
  $$
    select r.rolname::text
    from pg_roles r
    cross join pg_database d
    where d.datname = current_database()
      and r.rolname in ('anon', 'authenticated', 'service_role', 'authenticator')
      and pg_has_role(r.oid, d.datdba, 'MEMBER')
  $$,
  'DB-CLK-01 no client role owns the database, so none can add the mark'
);

select * from finish();
rollback;
