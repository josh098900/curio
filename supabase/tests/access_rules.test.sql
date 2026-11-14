-- Access rules that cover every table (test specification §3.2). Each feature's own policies
-- are tested with the feature. The rows are made here, since the seed cast arrives with T09.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- One row in every table in public, so a read that leaked would return something.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'one@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'two@example.com');
insert into public.profiles (id) values
  ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222')
  on conflict (id) do nothing;
insert into public.verification_sessions (user_id, provider, provider_session_id, status) values
  ('11111111-1111-4111-8111-111111111111', 'simulated', 'sim_rls01', 'verified');
insert into public.hostels
  (id, name, address, city, country, location, timezone, contact_email, applicant_role, applied_by)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Hostel Uno', 'Rua Augusta 1', 'Lisbon', 'PT',
   'SRID=4326;POINT(-9.14 38.71)', 'Europe/Lisbon', 'desk@example.com', 'Manager',
   '11111111-1111-4111-8111-111111111111');
insert into public.hostel_staff (hostel_id, user_id, staff_role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner');
insert into public.stays (user_id, hostel_id, check_in, check_out) values
  ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2027-01-10', '2027-01-12');
insert into public.activities
  (id, host_id, title, category, starts_at, ends_at, timezone, area_label, approx_location, max_participants)
values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'Sunset walk',
   'outdoors', '2027-01-10 18:00:00+00', '2027-01-10 20:00:00+00', 'Europe/Lisbon', 'Alfama',
   'SRID=4326;POINT(-9.13 38.71)', 4);
insert into public.activity_locations (activity_id, location, meeting_note) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'SRID=4326;POINT(-9.1312 38.7105)', 'By the fountain');
insert into public.activity_participants (activity_id, user_id, status) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'joined');
insert into public.messages (activity_id, sender_id, body) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'See you there');
insert into public.reports (reporter_id, target_type, target_id, reason) values
  ('22222222-2222-4222-8222-222222222222', 'user', '11111111-1111-4111-8111-111111111111', 'other');
insert into public.blocks (blocker_id, blocked_id) values
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111');
insert into public.notifications (user_id, type, payload, dedupe_key) values
  ('11111111-1111-4111-8111-111111111111', 'participant_joined',
   '{"activity_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}', 'joined:rls01');
insert into public.audit_log (id, actor_id, action, target_type, target_id, subject_id, reason) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '11111111-1111-4111-8111-111111111111', 'suspend_user',
   'user', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222',
   'Repeated harassment');
insert into public.moderation_appeals (user_id, audit_log_id, reason) values
  ('22222222-2222-4222-8222-222222222222', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   'I didn''t send those messages');

-- The test below loops over every table, so it would pass trivially for an empty one.
select is_empty(
  $$
    select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and (xpath('/row/count/text()',
        query_to_xml(format('select count(*) from public.%I', c.relname), false, true, '')))[1]::text = '0'
  $$,
  'DB-RLS-01 every table in public has a row for anon to find'
);

-- As anon, try to read, add to, change and delete from every table, and read every view.
-- Only "permission denied" counts as a refusal, which covers both a missing grant and a row
-- refused by RLS. Any other error means the statement got past access control and failed on
-- something later, such as a required column, so it's recorded as a leak, as is any success
-- that touched a row.
create temporary table rls01_leaks (leak text);

do $$
declare
  relation record;
  affected bigint;
  leaks text[] := '{}';
begin
  for relation in
    select c.relname, c.relkind,
      (select a.attname from pg_attribute a
       where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
       order by a.attnum limit 1) as first_column
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
    order by c.relname
  loop
    set local role anon;

    begin
      execute format('select count(*) from public.%I', relation.relname) into affected;
      if affected > 0 then
        leaks := leaks || format('%s: read %s rows', relation.relname, affected);
      end if;
    exception
      when insufficient_privilege then null;
      when others then leaks := leaks || format('%s: read got past access control (%s)', relation.relname, sqlstate);
    end;

    if relation.relkind <> 'v' then
      begin
        execute format('insert into public.%I default values', relation.relname);
        leaks := leaks || format('%s: inserted a row', relation.relname);
      exception
        when insufficient_privilege then null;
        when others then leaks := leaks || format('%s: insert got past access control (%s)', relation.relname, sqlstate);
      end;

      -- Setting a column to its default needs no SELECT, so UPDATE alone is enough to show.
      begin
        execute format('update public.%I set %I = default', relation.relname, relation.first_column);
        get diagnostics affected = row_count;
        if affected > 0 then
          leaks := leaks || format('%s: updated %s rows', relation.relname, affected);
        end if;
      exception
        when insufficient_privilege then null;
        when others then leaks := leaks || format('%s: update got past access control (%s)', relation.relname, sqlstate);
      end;

      begin
        execute format('delete from public.%I', relation.relname);
        get diagnostics affected = row_count;
        if affected > 0 then
          leaks := leaks || format('%s: deleted %s rows', relation.relname, affected);
        end if;
      exception
        when insufficient_privilege then null;
        when others then leaks := leaks || format('%s: delete got past access control (%s)', relation.relname, sqlstate);
      end;
    end if;

    reset role;
  end loop;

  insert into rls01_leaks select unnest(leaks);
end;
$$;

select is_empty('select leak from rls01_leaks', 'DB-RLS-01 anon reads nothing and writes nothing in any table');

-- Anon runs only public.health() and is given nothing else (spec §9, §13.1), so it holds no
-- privilege at all in public. This also catches a grant whose policy hasn't arrived yet.
select is_empty(
  $$
    select 'anon: ' || privilege || ' on ' || c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
    ]) as privilege
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_table_privilege('anon', c.oid, privilege)
    union all
    select 'anon: ' || privilege || ' on a column of ' || c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) as privilege
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_any_column_privilege('anon', c.oid, privilege)
    union all
    select 'anon: ' || privilege || ' on ' || c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) as privilege
    where n.nspname = 'public' and c.relkind = 'S'
      and has_sequence_privilege('anon', c.oid, privilege)
  $$,
  'DB-RLS-01 anon holds no privilege on any table, view, column or sequence in public'
);

-- TRUNCATE skips RLS, and neither client role ever needs TRIGGER, REFERENCES or MAINTAIN.
select is_empty(
  $$
    select r.rolname || ': ' || privilege || ' on ' || c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) as r (rolname)
    cross join unnest(array['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as privilege
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and has_table_privilege(r.rolname, c.oid, privilege)
  $$,
  'DB-RLS-01 no client role can truncate a table in public, or hold TRIGGER, REFERENCES or MAINTAIN on one'
);

-- The view runs as its reader, so a client would count only the participant rows it can see.
-- Only security definer functions read it (open question 8).
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}',
  true
);
select throws_ok(
  'select * from public.activity_status',
  '42501',
  null,
  'DB-RLS-34 a signed-in user can''t read activity_status directly'
);
reset role;

set local role anon;
select throws_ok(
  'select * from public.activity_status',
  '42501',
  null,
  'DB-RLS-34 anon can''t read activity_status directly'
);
reset role;

select * from finish();
rollback;
