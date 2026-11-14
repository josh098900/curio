-- DB-ERR-01: private.raise_error() (spec §11, §14.4). The code is the message, and PostgREST's PT
-- codes give each its HTTP status. Built with the rate limiter (T11); T12 adds DB-SCH-08.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

select throws_ok(
  format('select private.raise_error(%L)', c.code), 'PT' || c.status, c.code,
  format('DB-ERR-01 %s raises HTTP %s', c.code, c.status)
)
from (values
  ('NOT_VERIFIED', '403'), ('VERIFICATION_FINAL', '403'), ('ALREADY_VERIFIED', '409'), ('FULL', '409'),
  ('BLOCKED', '403'), ('CLOSED', '409'), ('SUSPENDED', '403'), ('NOT_ALLOWED', '403'), ('NOT_FOUND', '404'),
  ('INVALID_INPUT', '422'), ('RATE_LIMITED', '429'), ('UNAVAILABLE', '503')
) as c (code, status);

-- The details reach PostgREST as the error's detail, which it returns as "details".
create function pg_temp.detail_of(statement text) returns text
  language plpgsql
as $$
declare
  error_detail text;
begin
  execute statement;
  return 'no error';
exception when others then
  get stacked diagnostics error_detail = pg_exception_detail;
  return error_detail;
end;
$$;

select is(
  pg_temp.detail_of($$ select private.raise_error('INVALID_INPUT', '{"display_name": "too_long"}') $$)::jsonb,
  '{"display_name": "too_long"}'::jsonb,
  'DB-ERR-01 INVALID_INPUT carries its field details'
);

select is(
  pg_temp.detail_of($$ select private.raise_error('NOT_FOUND') $$),
  '',
  'DB-ERR-01 with no details, the error has none'
);

select throws_ok(
  $$ select private.raise_error('OOPS') $$,
  'P0001', null,
  'DB-ERR-01 a code that isn''t in spec 14.4 is refused, and never reaches a client as a status'
);

-- The code, message and detail of the error a statement raises.
create function pg_temp.error_of(statement text) returns text
  language plpgsql
as $$
declare
  error_state text;
  error_message text;
  error_detail text;
  error_hint text;
begin
  execute statement;
  return 'no error';
exception when others then
  get stacked diagnostics error_state = returned_sqlstate, error_message = message_text,
    error_detail = pg_exception_detail, error_hint = pg_exception_hint;
  return error_state || ' | ' || error_message || ' | ' || coalesce(nullif(error_detail, ''), '(no detail)')
    || coalesce(' | ' || nullif(error_hint, ''), '');
end;
$$;

-- Details only with INVALID_INPUT, and only as field names and the rule ids in spec 14.4, so
-- nothing a person wrote can reach the client or the log through them. Each refusal has a fixed
-- message and no detail.
select is(
  pg_temp.error_of(format('select private.raise_error(%L, %L)', 'INVALID_INPUT', d.details)),
  'P0001 | raise_error was given details that are not INVALID_INPUT field names and rule ids | (no detail)',
  'DB-ERR-01 refused, with none of it in the error: ' || d.description
)
from (values
  ('{"display_name": "Ana Smith"}', 'free text, such as a name'),
  ('{"display_name": "ana"}', 'a lower-case word that isn''t one of the rule ids'),
  ('{"display_name": 3}', 'a rule that isn''t a string'),
  ('["too_long"]', 'details that aren''t an object'),
  ('{"Display Name": "too_long"}', 'a field name that isn''t a short lower-case id'),
  ('{"' || repeat('a', 64) || '": "too_long"}', 'a field name longer than 63 characters')
) as d (details, description);
select is(
  pg_temp.error_of($$ select private.raise_error('NOT_FOUND', '{"id": "invalid"}') $$),
  'P0001 | raise_error was given details that are not INVALID_INPUT field names and rule ids | (no detail)',
  'DB-ERR-01 refused, with none of it in the error: details with any code but INVALID_INPUT'
);

-- As its callers will use it: a caller-rights SQL function, run as a signed-in user, which
-- can't use the private schema itself.
create function tests.find_nothing() returns integer
  language sql
begin atomic
  select private.raise_error('NOT_FOUND');
  select 1;
end;
grant execute on function tests.find_nothing() to authenticated;

select tests.act_as('nova');
select throws_ok(
  'select tests.find_nothing()', 'PT404', 'NOT_FOUND',
  'DB-ERR-01 a caller-rights read function, run as a signed-in user, raises through it'
);
select tests.stop_acting();

-- DB-ERR-02: the backstop every writing function ends with. Its handler reads the failed
-- constraint and hands it to private.raise_constraint_error.
create function pg_temp.write_with_backstop(statement text) returns void
  language plpgsql
as $$
declare
  failed_table text;
  failed_constraint text;
  failed_column text;
begin
  execute statement;
exception when check_violation or not_null_violation then
  get stacked diagnostics failed_table = table_name, failed_constraint = constraint_name,
    failed_column = column_name;
  perform private.raise_constraint_error(failed_table, failed_constraint, failed_column);
end;
$$;

select is(
  pg_temp.error_of($$ select pg_temp.write_with_backstop(format(
    'update public.profiles set display_name = %L where id = %L',
    'Secret Marker, a name far too long for anyone to display', tests.id('vic'))) $$),
  'PT422 | INVALID_INPUT | {"display_name": "invalid"}',
  'DB-ERR-02 a failed CHECK becomes INVALID_INPUT, naming the field with the rule invalid'
);
select ok(
  position('Secret Marker' in pg_temp.error_of($$ select pg_temp.write_with_backstop(format(
    'update public.profiles set display_name = %L where id = %L',
    'Secret Marker, a name far too long for anyone to display', tests.id('vic'))) $$)) = 0,
  'DB-ERR-02 none of the row''s values appear in the error'
);
select is(
  pg_temp.error_of($$ select pg_temp.write_with_backstop(
    'insert into public.hostels (name, address, city, country, location, timezone, contact_email, applicant_role)
     values (''Marker Hostel'', null, ''Lisbon'', ''PT'', ''SRID=4326;POINT(-9.1 38.7)'', ''Europe/Lisbon'',
             ''private-marker@example.com'', ''Manager'')') $$),
  'PT422 | INVALID_INPUT | {"address": "required"}',
  'DB-ERR-02 a missing required value becomes INVALID_INPUT, naming the field with the rule required'
);
select is(
  pg_temp.error_of($$ select pg_temp.write_with_backstop(format(
    'update public.activities set ends_at = starts_at where id = %L', tests.id('A1'))) $$),
  'PT422 | INVALID_INPUT | {"ends_at": "invalid"}',
  'DB-ERR-02 a rule across two columns names the field a person would change'
);
select is(
  pg_temp.error_of($$ select pg_temp.write_with_backstop(format(
    'insert into public.blocks (blocker_id, blocked_id) values (%1$L, %1$L)', tests.id('vic'))) $$),
  'PT422 | INVALID_INPUT | {"blocked_id": "invalid"}',
  'DB-ERR-02 blocking yourself names the person blocked'
);
-- Every CHECK in the schema names a real field: the column CHECKs by their names, the ones
-- across two columns through the helper's list. A new CHECK outside both would name "input".
select is_empty(
  $$
    select c.conrelid::regclass::text || ': ' || c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'c' and n.nspname in ('public', 'private')
      and pg_temp.error_of(format('select private.raise_constraint_error(%L, %L, %L)', t.relname, c.conname, ''))
        like '%"input"%'
  $$,
  'DB-ERR-02 every CHECK in the schema names a real field, never the fallback'
);
select is(
  pg_temp.error_of($$ select private.raise_constraint_error('profiles', 'profiles_made_up_rule', '') $$),
  'PT422 | INVALID_INPUT | {"input": "invalid"}',
  'DB-ERR-02 a constraint whose field can''t be worked out names "input"'
);
select ok(
  position('Failing row contains' in pg_temp.error_of(format(
    'update public.profiles set display_name = %L where id = %L', '', tests.id('vic')))) > 0,
  'DB-ERR-02 without the backstop, Postgres would put the failing row in the error'
);

select * from finish();
rollback;
