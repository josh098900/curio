-- The sign-up trigger (data dictionary, profiles: "A trigger creates it at sign-up, and onboarding
-- fills it in"). Supabase Auth inserts into auth.users as its own role, which a test can't
-- become, so this inserts as the migrations' role and checks in the catalogue what makes the
-- real path work: the function runs as its owner. T08 also checked once through the local Auth
-- API.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- A Google sign-in brings a name and a photo. Any client can also set the account's metadata
-- (signUp's options, updateUser), so this one tries to make itself a verified admin too.
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'new@example.com',
   '{"full_name": "Nova Example", "name": "Nova", "avatar_url": "https://example.com/nova.png",
     "display_name": "Nova", "role": "admin", "account_status": "active",
     "verification_status": "verified", "is_over_18": true, "age_band": "25-34",
     "languages": ["en"], "home_country": "PT"}',
   '{"provider": "google", "role": "admin", "verification_status": "verified", "is_over_18": true}');

select is(
  (select count(*)::integer from public.profiles where id = '11111111-1111-4111-8111-111111111111'), 1,
  'DB-JOB-01 a new sign-in account gets one profile'
);

select is(
  (select verification_status from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  'unverified',
  'DB-JOB-01 the new profile is unverified'
);

select is(
  (select account_status from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  'active',
  'DB-JOB-01 the new profile is active'
);

-- The whole row, so a column added later is covered too. Names and photos come only through
-- onboarding, and the server-only columns only from the server.
select is(
  (select to_jsonb(p) - 'id' - 'created_at' from public.profiles as p
   where p.id = '11111111-1111-4111-8111-111111111111'),
  jsonb_build_object(
    'display_name', null, 'bio', null, 'avatar_path', null, 'home_country', null,
    'languages', '[]'::jsonb, 'over_18_declared_at', null, 'terms_version', null,
    'terms_accepted_at', null, 'verification_status', 'unverified', 'verified_at', null,
    'is_over_18', false, 'age_band', null, 'role', 'traveller', 'account_status', 'active'
  ),
  'DB-JOB-01 every other column has its default, whatever the account''s metadata says'
);

select is(
  (select created_at from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  now(),
  'DB-JOB-01 the new profile records when it was created'
);

insert into auth.users (id, email) values ('22222222-2222-4222-8222-222222222222', 'second@example.com');
select is(
  (select count(*)::integer from public.profiles
   where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')),
  2,
  'DB-JOB-01 each new account gets its own profile'
);

select is_empty(
  $$
    select u.id from auth.users as u
    where not exists (select 1 from public.profiles as p where p.id = u.id)
  $$,
  'DB-JOB-01 every sign-in account has a profile'
);

-- What makes the real sign-up work, since this test can't insert as Auth's role.
select ok(
  not has_table_privilege('supabase_auth_admin', 'public.profiles', 'INSERT'),
  'DB-JOB-01 Auth''s own role can''t write profiles, so the trigger''s function must run as its owner'
);
select is_definer('private', 'create_profile', '{}'::name[], 'DB-JOB-01 create_profile runs as its owner');
select is(
  (select pg_get_userbyid(p.proowner)::text from pg_proc as p where p.oid = 'private.create_profile()'::regprocedure),
  'postgres',
  'DB-JOB-01 create_profile''s owner is postgres, which can write profiles'
);
select trigger_is(
  'auth', 'users', 'create_profile_after_sign_up', 'private', 'create_profile',
  'DB-JOB-01 the trigger on auth.users calls create_profile'
);
-- tgtype's bits: 1 for each row, 2 before, 4 insert, 8 delete, 16 update, 32 truncate, 64
-- instead of. 'O' fires normally.
select ok(
  exists (
    select 1 from pg_trigger as t
    where t.tgrelid = 'auth.users'::regclass and t.tgname = 'create_profile_after_sign_up'
      and t.tgenabled = 'O' and t.tgtype = 1 | 4
  ),
  'DB-JOB-01 the trigger is enabled, and fires after each insert only'
);

-- Beyond DB-JOB-01's case: the dictionary's "deleted with it", which shows the profile doesn't
-- stop Auth deleting an account (spec §9, account deletion).
delete from auth.users where id = '11111111-1111-4111-8111-111111111111';
select is_empty(
  $$ select id from public.profiles where id = '11111111-1111-4111-8111-111111111111' $$,
  'DB-JOB-01 deleting the sign-in account deletes its profile'
);

select * from finish();
rollback;
