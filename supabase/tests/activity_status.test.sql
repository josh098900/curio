-- The activity_status view at each edge (FR-ACT-10, D13, ADR-008), with the clock pinned
-- through private.now(). The rows are made here, since the seed cast arrives with T09.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- A host, three travellers (one suspended) and two activities with two places each, on
-- 10 and 11 January 2027, 18:00 to 20:00 UTC.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'host@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'joiner@example.com'),
  ('33333333-3333-4333-8333-333333333333', 'suspended@example.com'),
  ('44444444-4444-4444-8444-444444444444', 'leaver@example.com');
insert into public.profiles (id) select id from auth.users
  where id in (
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'
  )
  on conflict (id) do nothing;
update public.profiles set account_status = 'suspended' where id = '33333333-3333-4333-8333-333333333333';

insert into public.activities
  (id, host_id, title, category, starts_at, ends_at, timezone, area_label, approx_location, max_participants)
values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'Sunset walk',
   'outdoors', '2027-01-10 18:00:00+00', '2027-01-10 20:00:00+00', 'Europe/Lisbon', 'Alfama',
   'SRID=4326;POINT(-9.13 38.71)', 2),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111', 'Tapas night',
   'food', '2027-01-11 18:00:00+00', '2027-01-11 20:00:00+00', 'Europe/Lisbon', 'Bairro Alto',
   'SRID=4326;POINT(-9.14 38.71)', 2);

create function pg_temp.status_of(activity uuid) returns text
  language sql
  as $$ select status from public.activity_status where activity_id = activity $$;

create function pg_temp.joined_count_of(activity uuid) returns integer
  language sql
  as $$ select joined_count from public.activity_status where activity_id = activity $$;

select columns_are(
  'public', 'activity_status', array['activity_id', 'status', 'joined_count'],
  'DB-JOB-10 the view has the data dictionary''s columns'
);

select set_config('curio.test_now', '2027-01-10 12:00:00+00', true);

select is(
  pg_temp.status_of('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'scheduled',
  'DB-JOB-10 with no one joined, scheduled'
);

insert into public.activity_participants (activity_id, user_id, status, updated_at) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '44444444-4444-4444-8444-444444444444', 'left', now());
select is(
  pg_temp.joined_count_of('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 0,
  'DB-JOB-10 someone who left doesn''t count'
);

update public.activity_participants set status = 'removed'
  where user_id = '44444444-4444-4444-8444-444444444444';
select is(
  pg_temp.joined_count_of('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 0,
  'DB-JOB-10 someone removed doesn''t count'
);

insert into public.activity_participants (activity_id, user_id, status) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '33333333-3333-4333-8333-333333333333', 'joined');
select is(
  pg_temp.joined_count_of('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 1,
  'DB-JOB-10 a participant suspended after joining still holds their place'
);
select is(
  pg_temp.status_of('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'scheduled',
  'DB-JOB-10 one place of two left, scheduled'
);

insert into public.activity_participants (activity_id, user_id, status) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'joined');
select is(
  pg_temp.status_of('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'full',
  'DB-JOB-10 the last place taken, full'
);

update public.activity_participants set status = 'left', updated_at = now()
  where user_id = '22222222-2222-4222-8222-222222222222';
select is(
  pg_temp.status_of('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'scheduled',
  'DB-JOB-10 someone leaving a full activity makes it scheduled again'
);
update public.activity_participants set status = 'joined', updated_at = null
  where user_id = '22222222-2222-4222-8222-222222222222';

select set_config('curio.test_now', '2027-01-10 17:59:59+00', true);
select is(
  pg_temp.status_of('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'full',
  'DB-JOB-10 a second before the start, still full'
);

select set_config('curio.test_now', '2027-01-10 18:00:00+00', true);
select is(
  pg_temp.status_of('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'in_progress',
  'DB-JOB-10 at the start time, in progress'
);

select set_config('curio.test_now', '2027-01-10 19:59:59+00', true);
select is(
  pg_temp.status_of('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'in_progress',
  'DB-JOB-10 a second before the end, still in progress'
);

select set_config('curio.test_now', '2027-01-10 20:00:00+00', true);
select is(
  pg_temp.status_of('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'completed',
  'DB-JOB-10 at the end time, completed'
);

-- Cancellation: the second activity is cancelled at 09:00 on its day.
update public.activities set cancelled_at = '2027-01-11 09:00:00+00', cancel_reason = 'Rain'
  where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

select set_config('curio.test_now', '2027-01-11 08:59:59+00', true);
select is(
  pg_temp.status_of('cccccccc-cccc-4ccc-8ccc-cccccccccccc'), 'scheduled',
  'DB-JOB-10 a second before the cancellation, scheduled'
);

select set_config('curio.test_now', '2027-01-11 09:00:00+00', true);
select is(
  pg_temp.status_of('cccccccc-cccc-4ccc-8ccc-cccccccccccc'), 'cancelled',
  'DB-JOB-10 at the cancellation, cancelled'
);

insert into public.activity_participants (activity_id, user_id, status) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '22222222-2222-4222-8222-222222222222', 'joined'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '44444444-4444-4444-8444-444444444444', 'joined');
select is(
  pg_temp.status_of('cccccccc-cccc-4ccc-8ccc-cccccccccccc'), 'cancelled',
  'DB-JOB-10 a cancelled activity with every place taken stays cancelled, not full'
);

select set_config('curio.test_now', '2027-01-11 19:00:00+00', true);
select is(
  pg_temp.status_of('cccccccc-cccc-4ccc-8ccc-cccccccccccc'), 'cancelled',
  'DB-JOB-10 during its times, cancelled, not in progress'
);

select set_config('curio.test_now', '2027-01-12 09:00:00+00', true);
select is(
  pg_temp.status_of('cccccccc-cccc-4ccc-8ccc-cccccccccccc'), 'cancelled',
  'DB-JOB-10 after its end, cancelled, not completed'
);
select is(
  pg_temp.joined_count_of('cccccccc-cccc-4ccc-8ccc-cccccccccccc'), 2,
  'DB-JOB-10 the joined count still shows on a cancelled activity'
);

select * from finish();
rollback;
