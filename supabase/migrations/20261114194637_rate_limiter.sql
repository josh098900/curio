-- The error helper and the rate limiter (T11).

-- Raises one of the error codes in spec 14.4 (DB-ERR-01). The code is the message, and
-- PostgREST turns the PT code into the HTTP status, so each refusal reaches the client with the
-- status in the table. INVALID_INPUT's details name fields and rules only, never what was
-- submitted, because Postgres logs each error's detail (14.3); PostgREST returns them as a string
-- holding the JSON. Built with the rate limiter, which needs it; T12 adds the error-code fitness
-- function, DB-SCH-08. It reads nothing. Functions raise through it; policies never do, since a
-- policy that raised would turn "row hidden" into an error that shows the row exists.
-- It stays volatile, so the planner never runs it early.
create function private.raise_error(code text, details jsonb default null) returns void
  language plpgsql security definer
  set search_path = ''
as $$
declare
  status text := case code
    when 'NOT_VERIFIED' then '403'
    when 'VERIFICATION_FINAL' then '403'
    when 'ALREADY_VERIFIED' then '409'
    when 'FULL' then '409'
    when 'BLOCKED' then '403'
    when 'CLOSED' then '409'
    when 'SUSPENDED' then '403'
    when 'NOT_ALLOWED' then '403'
    when 'NOT_FOUND' then '404'
    when 'INVALID_INPUT' then '422'
    when 'RATE_LIMITED' then '429'
    when 'UNAVAILABLE' then '503'
  end;
begin
  -- A code outside the table is a bug. It's refused as an ordinary error, which PostgREST sends
  -- as a 400 with no Curio code, so a client never sees a made-up one.
  if status is null then
    raise exception 'raise_error was given a code that is not in spec section 14.4';
  end if;
  if details is null then
    raise exception using errcode = 'PT' || status, message = code;
  end if;
  raise exception using errcode = 'PT' || status, message = code, detail = details::text;
end;
$$;

-- Caller-rights read functions call it as the caller (DB-SCH-02's allow-list).
grant execute on function private.raise_error(text, jsonb) to authenticated;

-- A token bucket per user and action (spec 11, 14.5, D26). Each bucket holds up to the action's
-- limit and gets one token back each period divided by the limit, so a join comes back every 6
-- minutes and an ID check every 8 hours. A call uses one token, or raises RATE_LIMITED when the
-- bucket is empty. The error rolls back the whole call, the bucket included, so a refused action
-- uses nothing (DB-RATE-06). The row lock makes calls at once take turns, so two can't both take
-- the last token (DB-RATE-04).
--
-- RPC functions, the messages trigger and Edge Functions call it, all as the table's owner, so
-- no client role can run it. They pass the signed-in user's id, never one a client supplied. A
-- caller with no profile, such as an account deleted while its token still works, is refused
-- with NOT_ALLOWED, as the database rules say. The time comes from private.now(), so tests can
-- pin it.
create function private.consume_rate_limit(user_id uuid, action text) returns void
  language plpgsql security definer
  set search_path = ''
as $$
declare
  moment timestamptz := private.now();
  bucket_limit integer;
  refill_period interval;
  per_token interval;
  tokens_left integer;
  last_refill timestamptz;
  earned bigint;
begin
  -- The limits in 14.5.
  select l.bucket_limit, l.refill_period into bucket_limit, refill_period
  from (values
    ('join', 10, interval '1 hour'),
    ('create', 5, interval '24 hours'),
    ('report', 10, interval '24 hours'),
    ('message', 20, interval '1 minute'),
    ('verify', 3, interval '24 hours'),
    ('export', 3, interval '24 hours')
  ) as l (action, bucket_limit, refill_period)
  where l.action = consume_rate_limit.action;

  if not exists (select 1 from public.profiles as p where p.id = consume_rate_limit.user_id) then
    perform private.raise_error('NOT_ALLOWED');
  end if;

  -- A new bucket starts full. An action that isn't one of the six has no limit; the table's
  -- CHECK on action refuses it here.
  insert into private.rate_limit_buckets (user_id, action, tokens, refilled_at)
  values (consume_rate_limit.user_id, consume_rate_limit.action, coalesce(bucket_limit, 0), moment)
  on conflict on constraint rate_limit_buckets_pkey do nothing;

  select b.tokens, b.refilled_at into tokens_left, last_refill
  from private.rate_limit_buckets as b
  where b.user_id = consume_rate_limit.user_id and b.action = consume_rate_limit.action
  for update;

  -- Only a profile deleted since the check above takes the bucket with it.
  if not found then
    perform private.raise_error('NOT_ALLOWED');
  end if;

  -- A bucket stored above its limit, after a limit is lowered, gets no more than the new limit.
  tokens_left := least(tokens_left, bucket_limit);

  if tokens_left >= bucket_limit then
    -- A full bucket doesn't bank time: refilling starts from now.
    last_refill := moment;
  elsif moment > last_refill then
    -- One token for each whole share of the period since the last one came back. The part of a
    -- share that's left over counts towards the next token.
    per_token := refill_period / bucket_limit;
    earned := floor(extract(epoch from moment - last_refill) / extract(epoch from per_token));
    if earned > 0 then
      if tokens_left + earned >= bucket_limit then
        tokens_left := bucket_limit;
        last_refill := moment;
      else
        tokens_left := tokens_left + earned;
        last_refill := last_refill + per_token * earned;
      end if;
    end if;
  end if;

  if tokens_left < 1 then
    perform private.raise_error('RATE_LIMITED');
  end if;

  update private.rate_limit_buckets as b
  set tokens = tokens_left - 1, refilled_at = last_refill
  where b.user_id = consume_rate_limit.user_id and b.action = consume_rate_limit.action;
end;
$$;
