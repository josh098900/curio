-- DB-ERR-01: private.raise_error() (spec §11, §14.4). The code is the message, and PostgREST's PT
-- codes give each its HTTP status. Built with the rate limiter (T11); T12 adds DB-SCH-08.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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

select * from finish();
rollback;
