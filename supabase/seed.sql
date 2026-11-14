-- Local and CI databases only: the hosted projects never run the seed.

-- A backstop: a freshly reset local or CI database has no sign-in accounts yet, while both
-- hosted projects do, so a seed run by mistake against one of them stops here.
do $$
begin
  if exists (select 1 from auth.users) then
    raise exception 'seed.sql runs only on a freshly reset local database, and this one has accounts';
  end if;
end;
$$;

-- The test-clock mark. private.now() honours curio.test_now only on a database carrying this
-- comment, and only the database's owner can change it (DB-CLK-01). Tests pin the time with
-- tests.set_clock(), below.
comment on database postgres is 'curio:test-clock';

-- Test helpers (T09), local and CI only. They live in their own schema, outside public and
-- private, so the schema guards and the generated types never see them, and the Data API
-- doesn't expose it. Tests call them after switching roles, so both client roles may run them.
create schema tests;

-- The seed's time: Sunday 10 January 2027, 12:00 UTC, when every status in the test
-- specification's cast holds (§1).
create function tests.seed_time() returns timestamptz
  language sql immutable
begin atomic
  select '2027-01-10 12:00:00+00'::timestamptz;
end;

-- Pins private.now() for the rest of the transaction: to the seed's time, or to the time given.
create function tests.set_clock(moment timestamptz default tests.seed_time()) returns void
  language plpgsql
as $$
begin
  perform set_config('curio.test_now', moment::text, true);
end;
$$;

-- Each fixture's fixed id, by its name in the test specification: people in lower case, then
-- A1 to A7 and H1 and H2.
create function tests.id(fixture text) returns uuid
  language plpgsql immutable
as $$
declare
  found_id uuid;
begin
  found_id := case fixture
    when 'nova' then 'c0000000-0000-4000-8000-000000000001'
    when 'uma' then 'c0000000-0000-4000-8000-000000000002'
    when 'pia' then 'c0000000-0000-4000-8000-000000000003'
    when 'vic' then 'c0000000-0000-4000-8000-000000000004'
    when 'hal' then 'c0000000-0000-4000-8000-000000000005'
    when 'bea' then 'c0000000-0000-4000-8000-000000000006'
    when 'sam' then 'c0000000-0000-4000-8000-000000000007'
    when 'rex' then 'c0000000-0000-4000-8000-000000000008'
    when 'ref' then 'c0000000-0000-4000-8000-000000000009'
    when 'sta' then 'c0000000-0000-4000-8000-000000000010'
    when 'adm' then 'c0000000-0000-4000-8000-000000000011'
    when 'A1' then 'a0000000-0000-4000-8000-000000000001'
    when 'A2' then 'a0000000-0000-4000-8000-000000000002'
    when 'A3' then 'a0000000-0000-4000-8000-000000000003'
    when 'A4' then 'a0000000-0000-4000-8000-000000000004'
    when 'A5' then 'a0000000-0000-4000-8000-000000000005'
    when 'A6' then 'a0000000-0000-4000-8000-000000000006'
    when 'A7' then 'a0000000-0000-4000-8000-000000000007'
    when 'H1' then 'b0000000-0000-4000-8000-000000000001'
    when 'H2' then 'b0000000-0000-4000-8000-000000000002'
  end::uuid;
  -- A misspelt name fails loudly rather than matching nothing.
  if found_id is null then
    raise exception 'unknown fixture: %', fixture;
  end if;
  return found_id;
end;
$$;

-- Acts as a fixture for the rest of the transaction, as PostgREST would: anon with no session,
-- or authenticated with the fixture's id in the JWT claims. The older one-claim settings, which
-- auth.uid(), auth.role() and auth.jwt() read first, are cleared, so nothing earlier can leak in.
create function tests.act_as(fixture text) returns void
  language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim', '', true);
  if fixture = 'anon' then
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    perform set_config('role', 'anon', true);
  else
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', tests.id(fixture), 'role', 'authenticated', 'aud', 'authenticated')::text,
      true
    );
    perform set_config('role', 'authenticated', true);
  end if;
end;
$$;

-- Stops acting: back to the session's own role, with no JWT claims, so auth.uid() is null.
-- reset role alone would keep the last fixture's claims.
create function tests.stop_acting() returns void
  language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim', '', true);
  perform set_config('role', 'none', true);
end;
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- The test cast (test specification §1, the table and its note on how the fixtures connect).
-- Times are relative to the seed's time, written R below.

-- People. The sign-up trigger makes each profile; everyone but nova then onboards. Supabase
-- Auth reads the token columns as strings, so they're empty rather than null, as Auth itself
-- writes them; otherwise its admin API fails for every account. An empty encrypted_password
-- means no password. Each person also gets an email identity, so they can sign in through the
-- local stack, for example in T22's tests.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000', tests.id(f.name), 'authenticated', 'authenticated',
  f.name || '@curio.test', '', tests.seed_time() - interval '60 days', '', '', '', '',
  tests.seed_time() - interval '60 days', tests.seed_time() - interval '60 days',
  '{"provider": "email", "providers": ["email"]}', '{}'
from unnest(array['nova', 'uma', 'pia', 'vic', 'hal', 'bea', 'sam', 'rex', 'ref', 'sta', 'adm']) as f (name);

insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
select u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  'email', u.created_at, u.created_at
from auth.users as u
where u.email like '%@curio.test';

update public.profiles as p
set display_name = f.display_name,
  home_country = f.home_country,
  languages = f.languages,
  over_18_declared_at = tests.seed_time() - interval '60 days',
  terms_version = '2026-11',
  terms_accepted_at = tests.seed_time() - interval '60 days',
  verification_status = f.verification_status,
  verified_at = case when f.verification_status in ('verified', 'revoked') then tests.seed_time() - interval '50 days' end,
  is_over_18 = f.is_over_18,
  age_band = f.age_band,
  role = f.role,
  account_status = f.account_status,
  created_at = tests.seed_time() - interval '60 days'
from (values
  ('uma', 'Uma', null::text, '{}'::text[], 'unverified', false, null::text, 'traveller', 'active'),
  ('pia', 'Pia', null, '{}', 'pending', false, null, 'traveller', 'active'),
  ('vic', 'Vic', 'GB', '{en,pt}', 'verified', true, '18-24', 'traveller', 'active'),
  ('hal', 'Hal', 'PT', '{pt,en}', 'verified', true, '25-34', 'traveller', 'active'),
  ('bea', 'Bea', null, '{}', 'verified', true, '35-44', 'traveller', 'active'),
  ('sam', 'Sam', null, '{}', 'verified', true, '35-44', 'traveller', 'suspended'),
  ('rex', 'Rex', null, '{}', 'revoked', true, '25-34', 'traveller', 'active'),
  ('ref', 'Ref', null, '{}', 'refused', false, null, 'traveller', 'active'),
  ('sta', 'Sta', 'PT', '{pt,en,es}', 'verified', true, '25-34', 'traveller', 'active'),
  ('adm', 'Adm', null, '{en}', 'verified', true, '45-54', 'admin', 'active')
) as f (name, display_name, home_country, languages, verification_status, is_over_18, age_band, role, account_status)
where p.id = tests.id(f.name);

-- Verification history: one session each, from the simulated provider.
insert into public.verification_sessions (user_id, provider, provider_session_id, status, last_error_code,
                                          created_at, updated_at)
select tests.id(f.name), 'simulated', 'sim_' || f.name || '_1', f.status, f.error_code,
  tests.seed_time() - f.ago, tests.seed_time() - f.ago
from (values
  ('pia', 'processing', null::text, interval '20 minutes'),
  ('vic', 'verified', null, interval '50 days'),
  ('hal', 'verified', null, interval '50 days'),
  ('bea', 'verified', null, interval '50 days'),
  ('sam', 'verified', null, interval '50 days'),
  ('rex', 'verified', null, interval '50 days'),
  ('ref', 'requires_input', 'under_supported_age', interval '50 days'),
  ('sta', 'verified', null, interval '50 days'),
  ('adm', 'verified', null, interval '50 days')
) as f (name, status, error_code, ago);

-- Hostels: H1 approved, with sta as its owner; H2 pending.
insert into public.hostels (id, name, address, city, country, location, timezone, website, contact_email,
                            contact_phone, applicant_role, status, applied_by, reviewed_at, created_at)
values
  (tests.id('H1'), 'Gra' || chr(231) || 'a Hostel', 'Rua da Amostra 10', 'Lisbon', 'PT',
   extensions.st_setsrid(extensions.st_makepoint(-9.1310, 38.7170), 4326)::extensions.geography,
   'Europe/Lisbon', 'https://graca-hostel.curio.test', 'desk@graca-hostel.curio.test', null,
   'Manager', 'approved', tests.id('sta'), tests.seed_time() - interval '35 days',
   tests.seed_time() - interval '40 days'),
  (tests.id('H2'), 'Rio Hostel', 'Rua do Exemplo 5', 'Porto', 'PT',
   extensions.st_setsrid(extensions.st_makepoint(-8.6110, 41.1413), 4326)::extensions.geography,
   'Europe/Lisbon', null, 'hello@rio-hostel.curio.test', null,
   'Owner', 'pending', tests.id('bea'), null, tests.seed_time() - interval '2 days');

insert into public.hostel_staff (hostel_id, user_id, staff_role) values (tests.id('H1'), tests.id('sta'), 'owner');

-- hal has blocked bea.
insert into public.blocks (blocker_id, blocked_id, created_at)
values (tests.id('hal'), tests.id('bea'), tests.seed_time() - interval '20 days');

-- adm's decisions: approving H1, revoking rex and suspending sam, each with a reason. Only the
-- last two need one (DB-MOD-09), but the cast's note gives all three.
insert into public.audit_log (id, actor_id, action, target_type, target_id, subject_id, reason, created_at)
values
  ('d0000000-0000-4000-8000-000000000001', tests.id('adm'), 'approve_hostel', 'hostel', tests.id('H1'),
   tests.id('sta'), 'Checked the listing and the applicant''s role', tests.seed_time() - interval '35 days'),
  ('d0000000-0000-4000-8000-000000000002', tests.id('adm'), 'revoke_verification', 'user', tests.id('rex'),
   tests.id('rex'), 'A report showed the ID check wasn''t yours', tests.seed_time() - interval '10 days'),
  ('d0000000-0000-4000-8000-000000000003', tests.id('adm'), 'suspend_user', 'user', tests.id('sam'),
   tests.id('sam'), 'Repeated harassment of other travellers', tests.seed_time() - interval '5 days');

-- Activities A1 to A7, in Lisbon (UTC+0 in January). A7 stays live although sam is suspended,
-- which suspend_user wouldn't leave (it cancels upcoming hosted activities): it's the fixture for
-- the rules that hide a suspended host's activities (DB-RLS-09, DB-NEAR-05). The public point is the exact one rounded to
-- 0.01 degrees, until T25 sets the grid.
insert into public.activities (id, host_id, hostel_id, title, description, category, starts_at, ends_at,
                               timezone, area_label, approx_location, max_participants, cancelled_at,
                               cancel_reason, created_at)
select tests.id(f.activity), tests.id(f.host), f.hostel, f.title, f.description, f.category::public.activity_category,
  f.starts_at, f.ends_at, 'Europe/Lisbon', f.area_label,
  extensions.st_setsrid(extensions.st_makepoint(round(f.lon, 2), round(f.lat, 2)), 4326)::extensions.geography,
  f.max_participants, f.cancelled_at, f.cancel_reason, tests.seed_time() - f.created_ago
from (values
  ('A1', 'hal', null::uuid, 'Sunset walk in Alfama', 'An easy walk to the viewpoints.', 'outdoors',
   '2027-01-11 18:00:00+00'::timestamptz, '2027-01-11 20:00:00+00'::timestamptz, 'Alfama',
   -9.1300::numeric, 38.7114::numeric, 6, null::timestamptz, null::text, interval '14 days'),
  ('A2', 'hal', null, 'Tapas crawl', null, 'food',
   '2027-01-12 19:00:00+00', '2027-01-12 21:00:00+00', 'Bairro Alto',
   -9.1462, 38.7125, 2, null, null, interval '10 days'),
  ('A3', 'vic', null, 'Day trip to Sintra', 'Train from Rossio, back by evening.', 'day_trips',
   '2027-01-13 09:00:00+00', '2027-01-13 17:00:00+00', 'Rossio',
   -9.1393, 38.7139, 8, '2027-01-09 12:00:00+00', 'Rain forecast all day', interval '12 days'),
  ('A4', 'hal', null, 'Coffee and pastel de nata', null, 'chilled',
   '2027-01-10 11:00:00+00', '2027-01-10 14:00:00+00', 'Baixa',
   -9.1366, 38.7105, 4, null, null, interval '6 days'),
  ('A5', 'vic', null, 'Fado night', null, 'going_out',
   '2027-01-09 18:00:00+00', '2027-01-09 20:00:00+00', 'Cais do Sodr' || chr(233),
   -9.1446, 38.7060, 5, null, null, interval '8 days'),
  ('A6', 'sta', tests.id('H1'), 'Hostel quiz night', 'Teams made on the night.', 'chilled',
   '2027-01-12 20:00:00+00', '2027-01-12 22:00:00+00', 'Gra' || chr(231) || 'a',
   -9.1308, 38.7172, 10, null, null, interval '9 days'),
  ('A7', 'sam', null, 'Picnic in Pr' || chr(237) || 'ncipe Real', null, 'outdoors',
   '2027-01-11 15:00:00+00', '2027-01-11 17:00:00+00', 'Pr' || chr(237) || 'ncipe Real',
   -9.1494, 38.7166, 6, null, null, interval '7 days')
) as f (activity, host, hostel, title, description, category, starts_at, ends_at, area_label, lon, lat,
        max_participants, cancelled_at, cancel_reason, created_ago);

insert into public.activity_locations (activity_id, location, meeting_note)
select tests.id(f.activity),
  extensions.st_setsrid(extensions.st_makepoint(f.lon, f.lat), 4326)::extensions.geography, f.note
from (values
  ('A1', -9.1300, 38.7114, 'By the tiled bench at the viewpoint'),
  ('A2', -9.1462, 38.7125, 'Outside the first bar on the corner'),
  ('A3', -9.1393, 38.7139, 'Under the station clock'),
  ('A4', -9.1366, 38.7105, 'At the counter, inside'),
  ('A5', -9.1446, 38.7060, 'By the market entrance'),
  ('A6', -9.1308, 38.7172, 'In the hostel common room'),
  ('A7', -9.1494, 38.7166, 'By the cedar tree')
) as f (activity, lon, lat, note);

-- Who has joined. rex and sam joined A1 before the decisions about them.
insert into public.activity_participants (activity_id, user_id, status, joined_at)
select tests.id(f.activity), tests.id(f.person), 'joined', tests.seed_time() - f.ago
from (values
  ('A1', 'sta', interval '13 days'),
  ('A1', 'rex', interval '12 days'),
  ('A1', 'sam', interval '6 days'),
  ('A2', 'sta', interval '9 days'),
  ('A2', 'adm', interval '9 days'),
  ('A4', 'sta', interval '5 days'),
  ('A5', 'bea', interval '7 days')
) as f (activity, person, ago);
