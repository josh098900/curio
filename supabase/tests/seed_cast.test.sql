-- The seed cast (test specification §1, the fixtures table and its note on how they connect).
-- The test specification gives T09 no test IDs, so these checks are named after the cast.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

select tests.set_clock();

-- People

select is(
  (select to_jsonb(p) - 'id' - 'created_at' from public.profiles as p where p.id = tests.id('nova')),
  jsonb_build_object(
    'display_name', null, 'bio', null, 'avatar_path', null, 'home_country', null,
    'languages', '[]'::jsonb, 'over_18_declared_at', null, 'terms_version', null,
    'terms_accepted_at', null, 'verification_status', 'unverified', 'verified_at', null,
    'is_over_18', false, 'age_band', null, 'role', 'traveller', 'account_status', 'active'
  ),
  'Seed cast: nova is signed in and not onboarded, with only the sign-up trigger''s defaults'
);

select is_empty(
  $$ select id from public.verification_sessions where user_id = tests.id('nova') $$,
  'Seed cast: nova has never started an ID check'
);

select is_empty(
  $$
    select f.name
    from unnest(array['uma', 'pia', 'vic', 'hal', 'bea', 'sam', 'rex', 'ref', 'sta', 'adm']) as f (name)
    join public.profiles as p on p.id = tests.id(f.name)
    where p.display_name is null or p.over_18_declared_at is null or p.terms_version is distinct from '2026-11'
      or p.terms_accepted_at is null
  $$,
  'Seed cast: everyone but nova has onboarded, with a name, both declarations and terms 2026-11'
);

select is(
  (select verification_status from public.profiles where id = tests.id('uma')), 'unverified',
  'Seed cast: uma is onboarded and unverified'
);

select is_empty(
  $$ select id from public.verification_sessions where user_id = tests.id('uma') $$,
  'Seed cast: uma has never started an ID check'
);

select is(
  (select p.verification_status || ', session ' || s.status
   from public.profiles as p join public.verification_sessions as s on s.user_id = p.id
   where p.id = tests.id('pia')),
  'pending, session processing',
  'Seed cast: pia''s verification is pending, with one session processing'
);

select is(
  (select verification_status || ', ' || is_over_18 || ', ' || age_band from public.profiles where id = tests.id('vic')),
  'verified, true, 18-24',
  'Seed cast: vic is verified, aged 18 to 24'
);

select set_eq(
  $$ select id from public.activities where host_id = tests.id('hal') $$,
  $$ values (tests.id('A1')), (tests.id('A2')), (tests.id('A4')) $$,
  'Seed cast: hal hosts A1, A2 and A4, and nothing else'
);

select set_eq(
  $$ select blocker_id, blocked_id from public.blocks $$,
  $$ values (tests.id('hal'), tests.id('bea')) $$,
  'Seed cast: hal has blocked bea, and that''s the only block'
);

select is(
  (select account_status from public.profiles where id = tests.id('sam')), 'suspended',
  'Seed cast: sam is suspended'
);

select is(
  (select verification_status || ', ' || is_over_18 || ', ' || age_band from public.profiles where id = tests.id('rex')),
  'revoked, true, 25-34',
  'Seed cast: rex''s verification was revoked, and he keeps his age band'
);

select is(
  (select p.verification_status || ', ' || p.is_over_18 || ', ' || coalesce(p.age_band, 'no band')
     || ', session ' || s.status || ' with ' || s.last_error_code
   from public.profiles as p join public.verification_sessions as s on s.user_id = p.id
   where p.id = tests.id('ref')),
  'refused, false, no band, session requires_input with under_supported_age',
  'Seed cast: ref was refused as under 18'
);

select set_eq(
  $$ select hostel_id, user_id, staff_role from public.hostel_staff $$,
  $$ values (tests.id('H1'), tests.id('sta'), 'owner') $$,
  'Seed cast: sta is H1''s only staff account, as its owner, and H2 has no staff'
);

select set_eq(
  $$ select id from public.profiles where role = 'admin' $$,
  $$ values (tests.id('adm')) $$,
  'Seed cast: adm is the only admin'
);

select is(
  (select account_status from public.profiles where id = tests.id('adm')), 'active',
  'Seed cast: adm is active'
);

select set_eq(
  $$
    select f.name, p.age_band
    from unnest(array['vic', 'hal', 'bea', 'sam', 'rex', 'sta', 'adm']) as f (name)
    join public.profiles as p on p.id = tests.id(f.name)
  $$,
  $$ values ('vic', '18-24'), ('hal', '25-34'), ('sta', '25-34'), ('rex', '25-34'), ('bea', '35-44'),
            ('sam', '35-44'), ('adm', '45-54') $$,
  'Seed cast: the age bands'
);

select is_empty(
  $$
    select f.name
    from unnest(array['vic', 'hal', 'bea', 'sam', 'rex', 'sta', 'adm']) as f (name)
    where (select count(*) from public.verification_sessions as s
           where s.user_id = tests.id(f.name) and s.status = 'verified') <> 1
       or not (select is_over_18 and verified_at is not null from public.profiles where id = tests.id(f.name))
  $$,
  'Seed cast: each verified person, adm and rex included, has one verified session and is over 18'
);

select set_eq(
  $$ select f.name from unnest(array['vic', 'hal', 'bea', 'sam', 'sta', 'adm']) as f (name)
     join public.profiles as p on p.id = tests.id(f.name) where p.verification_status = 'verified' $$,
  $$ values ('vic'), ('hal'), ('bea'), ('sam'), ('sta'), ('adm') $$,
  'Seed cast: vic, hal, bea, sam, sta and adm are verified'
);

-- Activities, at the seed's time

select is(
  (select s.status || ', ' || s.joined_count || ' of ' || a.max_participants
   from public.activity_status as s join public.activities as a on a.id = s.activity_id
   where s.activity_id = tests.id('A1')),
  'scheduled, 3 of 6',
  'Seed cast: A1 is open, with places left'
);

select set_eq(
  $$ select user_id from public.activity_participants where activity_id = tests.id('A1') and status = 'joined' $$,
  $$ values (tests.id('sta')), (tests.id('rex')), (tests.id('sam')) $$,
  'Seed cast: sta, rex and sam have joined A1'
);

select is(
  (select count(distinct p.age_band)::integer
   from public.activity_participants as ap join public.profiles as p on p.id = ap.user_id
   where ap.activity_id = tests.id('A1') and ap.status = 'joined'),
  2,
  'Seed cast: A1''s participants are in two age bands'
);

select ok(
  (select bool_and(ap.joined_at < x.decided_at)
   from (values (tests.id('rex'), 'revoke_verification'), (tests.id('sam'), 'suspend_user')) as d (user_id, action)
   join public.activity_participants as ap on ap.user_id = d.user_id and ap.activity_id = tests.id('A1')
   join lateral (select created_at as decided_at from public.audit_log
                 where subject_id = d.user_id and action = d.action) as x on true),
  'Seed cast: rex and sam joined A1 before the decisions about them'
);

select is(
  (select s.status || ', ' || s.joined_count || ' of ' || a.max_participants
   from public.activity_status as s join public.activities as a on a.id = s.activity_id
   where s.activity_id = tests.id('A2')),
  'full, 2 of 2',
  'Seed cast: A2 is full, with 2 of 2 places taken'
);

select set_eq(
  $$ select user_id from public.activity_participants where activity_id = tests.id('A2') and status = 'joined' $$,
  $$ values (tests.id('sta')), (tests.id('adm')) $$,
  'Seed cast: sta and adm took A2''s places'
);

select is(
  (select s.status || ', host ' || (a.host_id = tests.id('vic')) || ', cancelled ' || (tests.seed_time() - a.cancelled_at)
   from public.activity_status as s join public.activities as a on a.id = s.activity_id
   where s.activity_id = tests.id('A3')),
  'cancelled, host true, cancelled 1 day',
  'Seed cast: A3 is vic''s, cancelled the day before the seed''s time'
);

select is(
  (select s.status || ', started ' || (tests.seed_time() - a.starts_at)
   from public.activity_status as s join public.activities as a on a.id = s.activity_id
   where s.activity_id = tests.id('A4')),
  'in_progress, started 01:00:00',
  'Seed cast: A4 is in progress, started an hour before the seed''s time'
);

select set_eq(
  $$ select user_id from public.activity_participants where activity_id = tests.id('A4') and status = 'joined' $$,
  $$ values (tests.id('sta')) $$,
  'Seed cast: sta has joined A4'
);

select is(
  (select s.status || ', host ' || (a.host_id = tests.id('vic')) || ', ended ' || a.ends_at
   from public.activity_status as s join public.activities as a on a.id = s.activity_id
   where s.activity_id = tests.id('A5')),
  'completed, host true, ended 2027-01-09 20:00:00+00',
  'Seed cast: A5 is vic''s, and finished the evening before the seed''s time'
);

select set_eq(
  $$ select user_id from public.activity_participants where activity_id = tests.id('A5') and status = 'joined' $$,
  $$ values (tests.id('bea')) $$,
  'Seed cast: bea joined A5'
);

select is(
  (select (a.hostel_id = tests.id('H1')) || ', host ' || (a.host_id = tests.id('sta')) || ', ' || s.status
   from public.activities as a join public.activity_status as s on s.activity_id = a.id
   where a.id = tests.id('A6')),
  'true, host true, scheduled',
  'Seed cast: A6 is an event of hostel H1, hosted by sta'
);

select is(
  (select (a.host_id = tests.id('sam')) || ', ' || (a.hostel_id is null) || ', ' || s.status
   from public.activities as a join public.activity_status as s on s.activity_id = a.id
   where a.id = tests.id('A7')),
  'true, true, scheduled',
  'Seed cast: A7 is hosted by sam, and still scheduled, so it tests the suspended-host rules'
);

select is_empty(
  $$
    select a.id from public.activities as a
    where not exists (select 1 from public.activity_locations as l where l.activity_id = a.id)
       or a.id not in (tests.id('A1'), tests.id('A2'), tests.id('A3'), tests.id('A4'), tests.id('A5'),
                       tests.id('A6'), tests.id('A7'))
  $$,
  'Seed cast: A1 to A7 are the only activities, each with an exact meeting point'
);

-- So a test can tell a leaked exact point from the public one.
select is_empty(
  $$
    select a.id from public.activities as a
    join public.activity_locations as l on l.activity_id = a.id
    where extensions.st_distance(a.approx_location, l.location) < 50
  $$,
  'Seed cast: every public point is at least 50 metres from its exact meeting point'
);

-- Hostels and decisions

select set_eq(
  $$ select id, status, applied_by from public.hostels $$,
  $$ values (tests.id('H1'), 'approved', tests.id('sta')), (tests.id('H2'), 'pending', tests.id('bea')) $$,
  'Seed cast: H1 is approved, applied for by sta, and H2 is pending, applied for by bea'
);

select set_eq(
  $$
    select action, subject_id, actor_id, reason is not null,
      (tests.seed_time() - created_at)::text
    from public.audit_log
  $$,
  $$ values ('approve_hostel', tests.id('sta'), tests.id('adm'), true, '35 days'),
            ('revoke_verification', tests.id('rex'), tests.id('adm'), true, '10 days'),
            ('suspend_user', tests.id('sam'), tests.id('adm'), true, '5 days') $$,
  'Seed cast: adm approved H1, revoked rex and suspended sam, each with a reason'
);

select is_empty(
  $$
    select 'stays' from public.stays union all select 'messages' from public.messages
    union all select 'reports' from public.reports union all select 'notifications' from public.notifications
    union all select 'appeals' from public.moderation_appeals
  $$,
  'Seed cast: no stays, messages, reports, notifications or appeals: tests add their own'
);

-- The helpers

select is(private.now(), '2027-01-10 12:00:00+00'::timestamptz, 'Seed cast: tests.set_clock() pins the seed''s time');

select tests.set_clock('2027-02-01 09:30:00+00');
select is(private.now(), '2027-02-01 09:30:00+00'::timestamptz, 'Seed cast: tests.set_clock(<time>) pins any other time');

select tests.act_as('vic');
select is(
  current_user::text || ', ' || auth.uid()::text, 'authenticated, ' || tests.id('vic')::text,
  'Seed cast: tests.act_as(''vic'') acts as vic, signed in'
);
select tests.act_as('hal');
select is(
  current_user::text || ', ' || auth.uid()::text, 'authenticated, ' || tests.id('hal')::text,
  'Seed cast: tests.act_as() switches from one fixture to another'
);
select tests.act_as('anon');
select is(
  current_user::text || ', ' || coalesce(auth.uid()::text, 'no user'), 'anon, no user',
  'Seed cast: tests.act_as(''anon'') acts with no session'
);
select tests.stop_acting();
select is(current_user::text, 'postgres', 'Seed cast: tests.stop_acting() goes back to the session''s own role');

select tests.act_as('vic');
select tests.stop_acting();
select is(
  current_user::text || ', ' || coalesce(auth.uid()::text, 'no user'), 'postgres, no user',
  'Seed cast: tests.stop_acting() clears the last fixture''s claims too'
);

select set_config('request.jwt.claim.sub', tests.id('vic')::text, true);
select tests.act_as('anon');
select is(
  coalesce(auth.uid()::text, 'no user'), 'no user',
  'Seed cast: tests.act_as() clears the older one-claim settings, so nothing earlier leaks in'
);
select tests.stop_acting();

select throws_ok(
  $$ select tests.id('zed') $$, 'P0001', 'unknown fixture: zed',
  'Seed cast: an unknown fixture name is refused'
);

-- The schema guards cover only public and private, so this keeps the helpers to these five,
-- none of which runs as its owner: a test acting as a fixture could otherwise do what no client can.
select set_eq(
  $$
    select p.proname || '(' || oidvectortypes(p.proargtypes) || ')'
    from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'tests'
  $$,
  $$ values ('act_as(text)'), ('id(text)'), ('seed_time()'), ('set_clock(timestamp with time zone)'),
            ('stop_acting()') $$,
  'Seed cast: the tests schema holds exactly the five helpers'
);
select is_empty(
  $$
    select p.proname from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'tests' and p.prosecdef
  $$,
  'Seed cast: no helper runs as its owner'
);

select * from finish();
rollback;
