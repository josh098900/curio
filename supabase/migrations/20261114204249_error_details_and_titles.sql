-- From T12's plan (open questions 26 and 29): error details limited to field names and rule
-- ids, a backstop that turns a failed constraint into INVALID_INPUT, and titles that refuse
-- hidden characters as display names do.

-- raise_error as T11 built it, now refusing details unless they're INVALID_INPUT's field names
-- and rule ids, such as {"display_name": "too_long"}. Postgres logs each error's detail and
-- PostgREST returns it, so nothing a person wrote can get through (14.3, 14.4). Field names are
-- short lower-case ids; rules must be one of the five in 14.4, which UT-ERR-01 compares with the
-- contracts package's list. It raises in exactly four places, which DB-SCH-08 checks.
create or replace function private.raise_error(code text, details jsonb default null) returns void
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
  details_allowed boolean := true;
begin
  -- A code outside the table, or details that aren't field names and rule ids, is a bug. It's
  -- refused as an ordinary error with a fixed message, which PostgREST sends as a 400 with no
  -- Curio code.
  if status is null then
    raise exception 'raise_error was given a code that is not in spec section 14.4';
  end if;
  -- Each test runs only once the one before has passed, so jsonb_each only ever sees an object.
  if details is not null then
    if code <> 'INVALID_INPUT' or pg_catalog.jsonb_typeof(details) <> 'object' then
      details_allowed := false;
    elsif exists (
      select 1
      from pg_catalog.jsonb_each(details) as d (field, rule)
      where d.field !~ '^[a-z][a-z0-9_]{0,62}$'
        or pg_catalog.jsonb_typeof(d.rule) <> 'string'
        -- The rule ids in spec 14.4.
        or (d.rule #>> '{}') not in ('required', 'too_short', 'too_long', 'hidden_characters', 'invalid')
    ) then
      details_allowed := false;
    end if;
  end if;
  if not details_allowed then
    raise exception 'raise_error was given details that are not INVALID_INPUT field names and rule ids';
  end if;
  if details is null then
    raise exception using errcode = 'PT' || status, message = code;
  end if;
  raise exception using errcode = 'PT' || status, message = code, detail = details::text;
end;
$$;

-- The backstop every function that writes values a client supplied ends with (DB-ERR-02): its
-- handler for
-- check_violation and not_null_violation passes the failed table, constraint and column here.
-- Postgres would otherwise put the whole failing row in the error and the log, a name, an email
-- address or an exact point among it. This names the field and a rule instead: required for a
-- missing value, invalid for a CHECK. A CHECK across two columns names the one a person would
-- change, and one whose field can't be worked out names "input".
create function private.raise_constraint_error(table_name text, constraint_name text, column_name text)
  returns void
  language plpgsql security definer
  set search_path = ''
as $$
declare
  field text;
  rule text := 'invalid';
begin
  if coalesce(column_name, '') <> '' then
    field := column_name;
    rule := 'required';
  else
    field := case constraint_name
      when 'activities_times_check' then 'ends_at'
      when 'stays_dates_check' then 'check_out'
      when 'blocks_not_self_check' then 'blocked_id'
      when 'audit_log_reason_check' then 'reason'
      when 'profiles_avatar_path_check' then 'avatar_path'
    end;
    -- Otherwise the column CHECK's own name: <table>_<column>_check.
    if field is null and constraint_name like table_name || '\_%\_check' then
      field := pg_catalog.substr(
        constraint_name,
        pg_catalog.length(table_name) + 2,
        pg_catalog.length(constraint_name) - pg_catalog.length(table_name) - 7
      );
    end if;
  end if;

  -- Only a real column of the table counts as a field.
  if field is null or not exists (
    select 1
    from pg_catalog.pg_attribute as a
    join pg_catalog.pg_class as c on c.oid = a.attrelid
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relname = raise_constraint_error.table_name
      and a.attname = field and a.attnum > 0 and not a.attisdropped
  ) then
    field := 'input';
  end if;

  perform private.raise_error('INVALID_INPUT', pg_catalog.jsonb_build_object(field, rule));
end;
$$;

-- The hidden-character rule T07 built, extended with the invisible characters T12's security
-- review found, so blank-looking names and titles stay refused (data dictionary, profiles and
-- activities). packages/contracts/src/text.ts holds the same rule.
-- Refused anywhere: C0 and C1 controls; U+00AD; U+034F; U+061C; the Hangul fillers U+115F,
-- U+1160, U+3164 and U+FFA0; U+17B4 and U+17B5; U+180E; U+200B; U+200E and U+200F; U+2028 and
-- U+2029; U+202A to U+202E; U+2060 to U+206F; U+2800; U+FEFF; U+FFF0 to U+FFFB; U+1BCA0 to
-- U+1BCA3; U+1D173 to U+1D17A.
-- Allowed only between two visible characters, never at an end, beside whitespace or doubled:
-- U+200C and U+200D, the zero-width non-joiner and joiner.
-- Allowed only straight after a visible character: the variation selectors U+FE00 to U+FE0F and
-- U+E0100 to U+E01EF, and the Mongolian free variation selectors U+180B to U+180D and U+180F,
-- which emoji such as a red heart use.
-- Allowed only inside a flag: the tag characters U+E0020 to U+E007E, after U+1F3F4 and ending
-- in U+E007F.
create or replace function private.has_no_hidden_characters(value text) returns boolean
  language sql immutable
begin atomic
  select value !~ '[\x01-\x1f\x7f-\x9f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2060-\u206f\u2800\u3164\ufeff\uffa0\ufff0-\ufffb\U0001bca0-\U0001bca3\U0001d173-\U0001d17a]'
    and value !~ '(^|[\t\n\x0b\f\r \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\u200c\u200d])[\u200c\u200d]'
    and value !~ '[\u200c\u200d]($|[\t\n\x0b\f\r \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000])'
    and value !~ '(^|[\t\n\x0b\f\r \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\u200c\u200d\ufe00-\ufe0f\U000e0100-\U000e01ef\u180b-\u180d\u180f])[\ufe00-\ufe0f\U000e0100-\U000e01ef\u180b-\u180d\u180f]'
    and pg_catalog.regexp_replace(value, '\U0001f3f4[\U000e0020-\U000e007e]+\U000e007f', '', 'g')
      !~ '[\U000e0000-\U000e007f]';
end;

-- Titles refuse the same control, zero-width and direction characters as display names, with
-- joiners allowed between two visible characters and flags allowed (open question 29).
alter table public.activities drop constraint activities_title_check;
alter table public.activities add constraint activities_title_check check (
  private.trimmed_length(title) between 3 and 80
  and title is nfc normalized
  and private.has_no_hidden_characters(title)
);
