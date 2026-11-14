-- The rate limiter (spec §11, §14.5, D26): a token bucket per user and action. A bucket holds up
-- to the action's limit, gets one token back each period divided by the limit, and refuses with
-- RATE_LIMITED when empty. Uses the seed cast, with the clock pinned to the seed's time.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

select tests.set_clock();

create function pg_temp.tokens(person text, bucket_action text) returns integer
  language sql
  as $$ select tokens from private.rate_limit_buckets where user_id = tests.id(person) and action = bucket_action $$;

create function pg_temp.refilled_at(person text, bucket_action text) returns timestamptz
  language sql
  as $$ select refilled_at from private.rate_limit_buckets where user_id = tests.id(person) and action = bucket_action $$;

-- Tries an action this many times at the same moment and counts how many were allowed.
create function pg_temp.allowed_at_once(person text, bucket_action text, attempts integer) returns integer
  language plpgsql
as $$
declare
  allowed integer := 0;
begin
  for attempt in 1..attempts loop
    begin
      perform private.consume_rate_limit(tests.id(person), bucket_action);
      allowed := allowed + 1;
    exception when sqlstate 'PT429' then
      null;
    end;
  end loop;
  return allowed;
end;
$$;

-- For a bucket emptied at the seed's time: tries once a second before one token's share of the
-- period has passed, and once when it has.
create function pg_temp.refill_edge(person text, bucket_action text, share interval) returns text
  language plpgsql
as $$
declare
  before_share text := 'allowed';
  at_share text := 'allowed';
begin
  perform tests.set_clock(tests.seed_time() + share - interval '1 second');
  begin
    perform private.consume_rate_limit(tests.id(person), bucket_action);
  exception when sqlstate 'PT429' then
    before_share := 'refused';
  end;
  perform tests.set_clock(tests.seed_time() + share);
  begin
    perform private.consume_rate_limit(tests.id(person), bucket_action);
  exception when sqlstate 'PT429' then
    at_share := 'refused';
  end;
  return before_share || ', then ' || at_share;
end;
$$;

-- DB-RATE-01: a bucket with tokens

select lives_ok(
  $$ select private.consume_rate_limit(tests.id('vic'), 'join') $$,
  'DB-RATE-01 a first call is allowed'
);
select is(pg_temp.tokens('vic', 'join'), 9, 'DB-RATE-01 a new bucket starts at the limit, and the call used one token');
select lives_ok(
  $$ select private.consume_rate_limit(tests.id('vic'), 'join') $$,
  'DB-RATE-01 a bucket with tokens allows the call'
);
select is(pg_temp.tokens('vic', 'join'), 8, 'DB-RATE-01 each allowed call uses one token');

select results_eq(
  $$
    select a.action, pg_temp.allowed_at_once('uma', a.action, a.attempts)
    from (values ('create', 6), ('export', 4), ('join', 11), ('message', 21), ('report', 11), ('verify', 4))
      as a (action, attempts)
    order by a.action
  $$,
  $$ values ('create', 5), ('export', 3), ('join', 10), ('message', 20), ('report', 10), ('verify', 3) $$,
  'DB-RATE-01 each action allows exactly its limit at once: join 10, create 5, report 10, message 20, verify 3, export 3'
);

-- DB-RATE-02: an empty bucket. uma's buckets are all empty now.

create temporary table before_refusal as
  select * from private.rate_limit_buckets where user_id = tests.id('uma');

select throws_ok(
  $$ select private.consume_rate_limit(tests.id('uma'), 'join') $$,
  'PT429', 'RATE_LIMITED',
  'DB-RATE-02 an empty bucket refuses with RATE_LIMITED, which PostgREST sends as HTTP 429'
);
select throws_ok(
  $$ select private.consume_rate_limit(tests.id('uma'), 'join') $$,
  'PT429', 'RATE_LIMITED',
  'DB-RATE-02 and goes on refusing while it''s empty'
);
select set_eq(
  $$ select * from private.rate_limit_buckets where user_id = tests.id('uma') $$,
  $$ select * from before_refusal $$,
  'DB-RATE-02 a refusal changes nothing'
);
select is_empty(
  $$ select user_id, action from private.rate_limit_buckets where tokens < 0 $$,
  'DB-RATE-02 tokens never go below zero'
);
select throws_ok(
  $$ select private.consume_rate_limit('99999999-9999-4999-8999-999999999999', 'join') $$,
  'PT403', 'NOT_ALLOWED',
  'DB-RATE-02 someone with no profile is refused with NOT_ALLOWED, not a database error'
);

-- DB-RATE-03: refilling. uma's join bucket emptied at the seed's time, so a join comes back
-- every 6 minutes after it (an hour divided by 10).

select tests.set_clock(tests.seed_time() + interval '5 minutes 59 seconds');
select throws_ok(
  $$ select private.consume_rate_limit(tests.id('uma'), 'join') $$,
  'PT429', 'RATE_LIMITED',
  'DB-RATE-03 a second short of the refill time for one join, still refused'
);

select tests.set_clock(tests.seed_time() + interval '6 minutes');
select lives_ok(
  $$ select private.consume_rate_limit(tests.id('uma'), 'join') $$,
  'DB-RATE-03 six minutes on, one join is back'
);
select is(pg_temp.tokens('uma', 'join'), 0, 'DB-RATE-03 only one: the bucket is empty again');

-- Nine minutes later is one and a half joins: one comes back, and the half isn't lost.
select tests.set_clock(tests.seed_time() + interval '15 minutes');
select lives_ok(
  $$ select private.consume_rate_limit(tests.id('uma'), 'join') $$,
  'DB-RATE-03 nine minutes later, one more join is back'
);
select is(
  pg_temp.refilled_at('uma', 'join'), tests.seed_time() + interval '12 minutes',
  'DB-RATE-03 the time towards the next token is kept'
);
select tests.set_clock(tests.seed_time() + interval '18 minutes');
select lives_ok(
  $$ select private.consume_rate_limit(tests.id('uma'), 'join') $$,
  'DB-RATE-03 so the next join is back on time, 6 minutes after the last'
);

select tests.set_clock(tests.seed_time() + interval '24 hours');
select lives_ok(
  $$ select private.consume_rate_limit(tests.id('uma'), 'create') $$,
  'DB-RATE-03 a day after creating was used up, it''s allowed again'
);
select is(pg_temp.tokens('uma', 'create'), 4, 'DB-RATE-03 after the whole refill period, the bucket is back to its limit');

select tests.set_clock(tests.seed_time() + interval '30 days');
select lives_ok(
  $$ select private.consume_rate_limit(tests.id('uma'), 'report') $$,
  'DB-RATE-03 a month after reporting was used up, it''s allowed again'
);
select is(pg_temp.tokens('uma', 'report'), 9, 'DB-RATE-03 the bucket never fills beyond its limit, however long it''s been');

-- Each action's share of its period, to the second, for ref, whose buckets are emptied first.
select tests.set_clock();
select pg_temp.allowed_at_once('ref', a.action, a.bucket_limit)
from (values ('join', 10), ('create', 5), ('report', 10), ('message', 20), ('verify', 3), ('export', 3))
  as a (action, bucket_limit);
select results_eq(
  $$
    select a.action, pg_temp.refill_edge('ref', a.action, a.share)
    from (values ('create', interval '4 hours 48 minutes'), ('export', interval '8 hours'),
                 ('join', interval '6 minutes'), ('message', interval '3 seconds'),
                 ('report', interval '2 hours 24 minutes'), ('verify', interval '8 hours'))
      as a (action, share)
    order by a.action
  $$,
  $$ values ('create', 'refused, then allowed'), ('export', 'refused, then allowed'), ('join', 'refused, then allowed'),
            ('message', 'refused, then allowed'), ('report', 'refused, then allowed'), ('verify', 'refused, then allowed') $$,
  'DB-RATE-03 each action gets a token back after its share: create 4h48, export and verify 8h, join 6 min, message 3 s, report 2h24'
);

-- A bucket stored above its limit, as after a limit is lowered, gives no more than the limit.
select tests.set_clock();
insert into private.rate_limit_buckets (user_id, action, tokens, refilled_at)
values (tests.id('pia'), 'join', 15, tests.seed_time());
select lives_ok(
  $$ select private.consume_rate_limit(tests.id('pia'), 'join') $$,
  'DB-RATE-03 a bucket stored above its limit still allows the call'
);
select is(pg_temp.tokens('pia', 'join'), 9, 'DB-RATE-03 but brings the bucket down to the limit first');

-- DB-RATE-05: separate buckets

select is(pg_temp.allowed_at_once('vic', 'join', 20), 8, 'DB-RATE-05 vic uses up the rest of their joins');
select lives_ok(
  $$ select private.consume_rate_limit(tests.id('vic'), 'message') $$,
  'DB-RATE-05 using up joins leaves messaging alone'
);
select lives_ok(
  $$ select private.consume_rate_limit(tests.id('hal'), 'join') $$,
  'DB-RATE-05 each person has their own buckets: vic running out doesn''t stop hal'
);
select throws_ok(
  $$ select private.consume_rate_limit(tests.id('vic'), 'login') $$,
  '23514', null,
  'DB-RATE-05 an action that isn''t one of the six is refused'
);

-- DB-RATE-04: two calls at once for the last token. A pgTAP test runs in one session, so two
-- more connections race through dblink, which commits for real; they clean up after themselves,
-- and use nova's export bucket, which no other test uses. They connect to the address this
-- session arrived on, since the local stack trusts localhost without a password, which dblink
-- refuses. The password is the local stack's well-known default.
create extension if not exists dblink with schema extensions;

create function pg_temp.connection() returns text
  language sql
  as $$
    select format('host=%s port=%s dbname=postgres user=postgres password=postgres',
                  host(inet_server_addr()), inet_server_port())
  $$;

select extensions.dblink_connect('first', pg_temp.connection());
select extensions.dblink_connect('second', pg_temp.connection());
select extensions.dblink_exec('first', 'set statement_timeout = ''10s''');
select extensions.dblink_exec('second', 'set statement_timeout = ''10s''');

create temporary table racers as
select
  (select pid from extensions.dblink('first', 'select pg_backend_pid()') as r (pid integer)) as first_pid,
  (select pid from extensions.dblink('second', 'select pg_backend_pid()') as r (pid integer)) as second_pid;

-- Waits until the second connection is blocked by the first, so the calls really overlap. This
-- waits for a lock, not for time to pass, and gives up after about five seconds.
create function pg_temp.second_waits_for_first() returns boolean
  language plpgsql
as $$
begin
  for attempt in 1..500 loop
    if exists (select 1 from racers where pg_blocking_pids(second_pid) @> array[first_pid]) then
      return true;
    end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end;
$$;

-- Gives nova's export bucket one token left, committed, so both connections see it.
create function pg_temp.one_token_left() returns text
  language sql
  as $$
    select extensions.dblink_exec('first', format(
      $sql$
        delete from private.rate_limit_buckets where user_id = %1$L and action = 'export';
        insert into private.rate_limit_buckets (user_id, action, tokens, refilled_at) values (%1$L, 'export', 1, %2$L);
      $sql$, tests.id('nova'), tests.seed_time()))
  $$;

create function pg_temp.second_tries() returns integer
  language sql
  as $$
    select extensions.dblink_exec('second', 'begin');
    select extensions.dblink_exec('second', 'do $do$ begin perform tests.set_clock(); end $do$');
    select extensions.dblink_send_query('second', format('select private.consume_rate_limit(%L, ''export'')::text', tests.id('nova')));
  $$;

-- First case: the first call takes the last token and holds the bucket until it commits.
select pg_temp.one_token_left();
select extensions.dblink_exec('first', 'begin');
select extensions.dblink_exec('first', 'do $do$ begin perform tests.set_clock(); end $do$');
select lives_ok(
  format('select extensions.dblink_exec(%L, %L)', 'first',
         format('do $do$ begin perform private.consume_rate_limit(%L, %L); end $do$', tests.id('nova'), 'export')),
  'DB-RATE-04 the first call takes the last token, and holds the bucket until it commits'
);
select pg_temp.second_tries();
select ok(pg_temp.second_waits_for_first(), 'DB-RATE-04 the second call waits for the first');
select extensions.dblink_exec('first', 'commit');
select throws_ok(
  $$ select * from extensions.dblink_get_result('second') as r (result text) $$,
  'PT429', 'RATE_LIMITED',
  'DB-RATE-04 once the first commits, the second finds the bucket empty and is refused'
);
select * from extensions.dblink_get_result('second', false) as r (result text);
select extensions.dblink_exec('second', 'rollback');
select is(pg_temp.tokens('nova', 'export'), 0, 'DB-RATE-04 exactly one call was allowed: the bucket is at zero, not below');

-- Second case: the first connection stands in for a call that has read the bucket but not yet
-- written it. Without the row lock, the second call would read the last token too, and both
-- would be allowed.
select pg_temp.one_token_left();
select extensions.dblink_exec('first', 'begin');
select * from extensions.dblink('first', format(
  'select tokens from private.rate_limit_buckets where user_id = %L and action = ''export'' for update',
  tests.id('nova'))) as r (tokens integer);
select pg_temp.second_tries();
select ok(pg_temp.second_waits_for_first(), 'DB-RATE-04 a second call waits while the first has read the bucket');
select extensions.dblink_exec('first', format(
  'update private.rate_limit_buckets set tokens = 0 where user_id = %L and action = ''export''', tests.id('nova')));
select extensions.dblink_exec('first', 'commit');
select throws_ok(
  $$ select * from extensions.dblink_get_result('second') as r (result text) $$,
  'PT429', 'RATE_LIMITED',
  'DB-RATE-04 it then sees the first took the last token, and is refused rather than taking it too'
);
select * from extensions.dblink_get_result('second', false) as r (result text);
select extensions.dblink_exec('second', 'rollback');
select is(pg_temp.tokens('nova', 'export'), 0, 'DB-RATE-04 still exactly one: the bucket is at zero');

select extensions.dblink_exec('first', format(
  $sql$ delete from private.rate_limit_buckets where user_id = %L and action = 'export' $sql$, tests.id('nova')));
select extensions.dblink_disconnect('first');
select extensions.dblink_disconnect('second');

select * from finish();
rollback;
