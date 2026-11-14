-- The policy helpers (spec §9, §11): read-only, security definer, the caller always from
-- auth.uid(), and only active accounts count (open question 10). The policies that use them
-- arrive with their features, which test them again through the DB-RLS cases. The rows are made
-- here, since the seed cast arrives with T09.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- A host; a participant (who has blocked the host); people who left, were removed or were
-- suspended after joining; someone who never joined; an admin and a suspended admin.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'host@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'participant@example.com'),
  ('33333333-3333-4333-8333-333333333333', 'left@example.com'),
  ('44444444-4444-4444-8444-444444444444', 'removed@example.com'),
  ('55555555-5555-4555-8555-555555555555', 'suspended@example.com'),
  ('66666666-6666-4666-8666-666666666666', 'stranger@example.com'),
  ('77777777-7777-4777-8777-777777777777', 'admin@example.com'),
  ('88888888-8888-4888-8888-888888888888', 'suspended-admin@example.com');
insert into public.profiles (id)
  select id from auth.users where email like '%@example.com'
  on conflict (id) do nothing;
update public.profiles set role = 'admin'
  where id in ('77777777-7777-4777-8777-777777777777', '88888888-8888-4888-8888-888888888888');

insert into public.activities
  (id, host_id, title, category, starts_at, ends_at, timezone, area_label, approx_location, max_participants)
values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'Sunset walk',
   'outdoors', '2027-01-10 18:00:00+00', '2027-01-10 20:00:00+00', 'Europe/Lisbon', 'Alfama',
   'SRID=4326;POINT(-9.13 38.71)', 10);
insert into public.activity_participants (activity_id, user_id, status) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'joined'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '33333333-3333-4333-8333-333333333333', 'left'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '44444444-4444-4444-8444-444444444444', 'removed'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '55555555-5555-4555-8555-555555555555', 'joined');
update public.profiles set account_status = 'suspended'
  where id in ('55555555-5555-4555-8555-555555555555', '88888888-8888-4888-8888-888888888888');
insert into public.blocks (blocker_id, blocked_id) values
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111');

-- The caller, as PostgREST sets it from the JWT. An empty value means no session.
create function pg_temp.as_caller(caller text) returns void
  language sql
  as $$ select set_config('request.jwt.claims', coalesce(json_build_object('sub', caller, 'role', 'authenticated')::text, ''), true) $$;

-- DB-HLP-01 is_participant

select pg_temp.as_caller('22222222-2222-4222-8222-222222222222');
select is(private.is_participant('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), true,
  'DB-HLP-01 someone who joined and is active is a participant');
select is(private.is_participant('cccccccc-cccc-4ccc-8ccc-cccccccccccc'), false,
  'DB-HLP-01 an activity that doesn''t exist has no participants');

select pg_temp.as_caller('33333333-3333-4333-8333-333333333333');
select is(private.is_participant('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), false,
  'DB-HLP-01 someone who left isn''t a participant');

select pg_temp.as_caller('44444444-4444-4444-8444-444444444444');
select is(private.is_participant('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), false,
  'DB-HLP-01 someone removed isn''t a participant');

select pg_temp.as_caller('55555555-5555-4555-8555-555555555555');
select is(private.is_participant('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), false,
  'DB-HLP-01 someone suspended after joining isn''t a participant');

select pg_temp.as_caller('66666666-6666-4666-8666-666666666666');
select is(private.is_participant('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), false,
  'DB-HLP-01 someone who never joined isn''t a participant');

select pg_temp.as_caller('11111111-1111-4111-8111-111111111111');
select is(private.is_participant('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), false,
  'DB-HLP-01 the host isn''t a participant: policies give the host a branch of its own');

select pg_temp.as_caller(null);
select is(private.is_participant('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), false,
  'DB-HLP-01 with no session, nobody is a participant');

-- DB-HLP-02 is_admin

select pg_temp.as_caller('77777777-7777-4777-8777-777777777777');
select is(private.is_admin(), true, 'DB-HLP-02 an active admin is an admin');

select pg_temp.as_caller('88888888-8888-4888-8888-888888888888');
select is(private.is_admin(), false, 'DB-HLP-02 a suspended admin isn''t an admin');

select pg_temp.as_caller('22222222-2222-4222-8222-222222222222');
select is(private.is_admin(), false, 'DB-HLP-02 a traveller isn''t an admin');

select pg_temp.as_caller(null);
select is(private.is_admin(), false, 'DB-HLP-02 with no session, nobody is an admin');

-- DB-HLP-03 is_blocked

select pg_temp.as_caller('22222222-2222-4222-8222-222222222222');
select is(private.is_blocked('11111111-1111-4111-8111-111111111111'), true,
  'DB-HLP-03 a block the caller made counts');

select pg_temp.as_caller('11111111-1111-4111-8111-111111111111');
select is(private.is_blocked('22222222-2222-4222-8222-222222222222'), true,
  'DB-HLP-03 a block made against the caller counts too');
select is(private.is_blocked('66666666-6666-4666-8666-666666666666'), false,
  'DB-HLP-03 no block between two people, no block');
select is(private.is_blocked('99999999-9999-4999-8999-999999999999'), false,
  'DB-HLP-03 an id that doesn''t exist answers as an unblocked person does');

select pg_temp.as_caller('66666666-6666-4666-8666-666666666666');
select is(private.is_blocked('22222222-2222-4222-8222-222222222222'), false,
  'DB-HLP-03 a block between two other people says nothing to a third');

select pg_temp.as_caller(null);
select is(private.is_blocked('11111111-1111-4111-8111-111111111111'), true,
  'DB-HLP-03 with no session, it answers blocked, so a policy fails closed');

select * from finish();
rollback;
