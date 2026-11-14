-- The schema from the data dictionary (T07): every table, column, rule, key and index, the
-- activity_category type, the activity_status view, the avatars bucket, private.now() and the
-- three policy helpers.
--
-- Nothing here is reachable by a client yet. RLS is on for every table in public, with no
-- policies, and no table, view or column is granted to anon or authenticated: each feature's
-- task adds its own policies and grants (spec §9, ADR-003). Writes go through security definer
-- functions, except the messages that participants post from T41.

create extension if not exists postgis with schema extensions;

create type public.activity_category as enum ('going_out', 'food', 'day_trips', 'outdoors', 'chilled');

-- Helpers for the CHECKs. A CHECK runs as the role writing the row, which needs execute on any
-- function it calls, so these sit only on tables that security definer functions write. They're
-- granted to nobody: messages, which clients write directly, repeats the trimming inline. T12's
-- validation package copies each rule, so the two give the same verdict (UT-VAL-18).

-- A length after trimming the characters JavaScript's String.prototype.trim() removes, so the
-- database and the shared validation package agree (T12, UT-VAL-18): tab, line feed, vertical
-- tab, form feed, carriage return, space, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029,
-- U+202F, U+205F, U+3000 and U+FEFF.
create function private.trimmed_length(value text) returns integer
  language sql immutable
begin atomic
  select pg_catalog.char_length(pg_catalog.btrim(value,
    E'\t\n\x0b\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'));
end;

-- ISO 639-1 language codes, from the ISO 639-2 registration authority's list (the Library of
-- Congress, November 2026): 183 codes. Up to the caller to limit the count; this checks each
-- code is on the list and that none repeats.
create function private.are_language_codes(codes text[]) returns boolean
  language sql immutable
begin atomic
  select coalesce(pg_catalog.array_ndims(codes), 1) = 1
    and not exists (
      select 1
      from pg_catalog.unnest(codes) as c (code)
      where c.code is null or c.code not in (
        'aa', 'ab', 'ae', 'af', 'ak', 'am', 'an', 'ar', 'as', 'av', 'ay', 'az', 'ba', 'be', 'bg', 'bi',
        'bm', 'bn', 'bo', 'br', 'bs', 'ca', 'ce', 'ch', 'co', 'cr', 'cs', 'cu', 'cv', 'cy', 'da', 'de',
        'dv', 'dz', 'ee', 'el', 'en', 'eo', 'es', 'et', 'eu', 'fa', 'ff', 'fi', 'fj', 'fo', 'fr', 'fy',
        'ga', 'gd', 'gl', 'gn', 'gu', 'gv', 'ha', 'he', 'hi', 'ho', 'hr', 'ht', 'hu', 'hy', 'hz', 'ia',
        'id', 'ie', 'ig', 'ii', 'ik', 'io', 'is', 'it', 'iu', 'ja', 'jv', 'ka', 'kg', 'ki', 'kj', 'kk',
        'kl', 'km', 'kn', 'ko', 'kr', 'ks', 'ku', 'kv', 'kw', 'ky', 'la', 'lb', 'lg', 'li', 'ln', 'lo',
        'lt', 'lu', 'lv', 'mg', 'mh', 'mi', 'mk', 'ml', 'mn', 'mr', 'ms', 'mt', 'my', 'na', 'nb', 'nd',
        'ne', 'ng', 'nl', 'nn', 'no', 'nr', 'nv', 'ny', 'oc', 'oj', 'om', 'or', 'os', 'pa', 'pi', 'pl',
        'ps', 'pt', 'qu', 'rm', 'rn', 'ro', 'ru', 'rw', 'sa', 'sc', 'sd', 'se', 'sg', 'si', 'sk', 'sl',
        'sm', 'sn', 'so', 'sq', 'sr', 'ss', 'st', 'su', 'sv', 'sw', 'ta', 'te', 'tg', 'th', 'ti', 'tk',
        'tl', 'tn', 'to', 'tr', 'ts', 'tt', 'tw', 'ty', 'ug', 'uk', 'ur', 'uz', 've', 'vi', 'vo', 'wa',
        'wo', 'xh', 'yi', 'yo', 'za', 'zh', 'zu'
      )
    )
    and (
      select pg_catalog.count(distinct c.code) from pg_catalog.unnest(codes) as c (code)
    ) = pg_catalog.cardinality(codes);
end;

-- ISO 3166-1 alpha-2 country codes, from the time-zone database's iso3166.tab (current as of
-- ISO/TC 46 N1127, February 2024): 249 codes. XK, which ISO hasn't assigned, isn't one.
create function private.is_country_code(code text) returns boolean
  language sql immutable
begin atomic
  select code in (
    'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
    'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
    'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
    'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE',
    'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
    'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
    'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
    'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC',
    'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
    'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
    'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG',
    'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
    'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
    'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO',
    'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
    'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW'
  );
end;

-- An IANA time zone name the database knows, such as Europe/Lisbon. The posix/ and right/
-- copies, and the files that aren't zones, are refused, as JavaScript's Intl refuses them.
create function private.is_time_zone(zone text) returns boolean
  language sql stable
begin atomic
  select zone !~ '^(posix|right)/'
    and zone not in ('posixrules', 'localtime', 'Factory')
    and exists (select 1 from pg_catalog.pg_timezone_names as z where z.name = is_time_zone.zone);
end;

-- A display name with no control or hidden characters (data dictionary, profiles).
-- Refused anywhere: C0 and C1 controls; U+00AD soft hyphen; U+034F combining grapheme joiner;
-- U+061C Arabic letter mark; the Hangul fillers U+115F, U+1160, U+3164 and U+FFA0; U+180E;
-- U+200B zero-width space; U+200E and U+200F direction marks; U+2028 and U+2029 line and
-- paragraph separators; U+202A to U+202E and U+2066 to U+2069, direction embeddings,
-- overrides and isolates; U+2060 to U+2064 and U+206A to U+206F, invisible format characters;
-- U+2800 blank braille; U+FEFF; U+FFF9 to U+FFFB annotation characters; U+1D173 to U+1D17A.
-- Allowed only between two visible characters, never at an end, beside whitespace or doubled:
-- U+200C zero-width non-joiner and U+200D zero-width joiner, which Persian and Sinhala
-- spelling and emoji such as a woman technologist use.
-- Allowed only inside a flag: the tag characters U+E0020 to U+E007E, after U+1F3F4 and ending
-- in U+E007F, as in the flags of England, Scotland and Wales.
create function private.has_no_hidden_characters(value text) returns boolean
  language sql immutable
begin atomic
  select value !~ '[\x01-\x1f\x7f-\x9f\u00ad\u034f\u061c\u115f\u1160\u180e\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u206f\u2800\u3164\ufeff\uffa0\ufff9-\ufffb\U0001d173-\U0001d17a]'
    and value !~ '(^|[\t\n\x0b\f\r \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\u200c\u200d])[\u200c\u200d]'
    and value !~ '[\u200c\u200d]($|[\t\n\x0b\f\r \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000])'
    and pg_catalog.regexp_replace(value, '\U0001f3f4[\U000e0020-\U000e007e]+\U000e007f', '', 'g')
      !~ '[\U000e0000-\U000e007f]';
end;

-- The time business rules use (spec §11). Tests pin it with
-- set_config('curio.test_now', <time>, true), which counts only on a database whose comment
-- seed.sql has set to 'curio:test-clock'. Only the database's owner can change the comment, no
-- request can set either one, and the hosted projects never run the seed (DB-CLK-01).
create function private.now() returns timestamptz
  language sql stable
begin atomic
  select case
    when pg_catalog.shobj_description(
        (select d.oid from pg_catalog.pg_database as d where d.datname = pg_catalog.current_database()),
        'pg_database'
      ) = 'curio:test-clock'
      and coalesce(pg_catalog.current_setting('curio.test_now', true), '') <> ''
    then pg_catalog.current_setting('curio.test_now', true)::timestamptz
    else pg_catalog.now()
  end;
end;

-- Accounts and verification

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (
    private.trimmed_length(display_name) between 1 and 40
    and display_name is nfc normalized
    and private.has_no_hidden_characters(display_name)
  ),
  bio text check (private.trimmed_length(bio) <= 300 and bio is nfc normalized),
  -- A file directly inside the user's own folder of the avatars bucket.
  avatar_path text constraint profiles_avatar_path_check
    check (avatar_path ~ ('^' || id::text || '/[A-Za-z0-9_-][A-Za-z0-9._-]*$')),
  home_country text check (private.is_country_code(home_country)),
  languages text[] not null default '{}'
    check (pg_catalog.cardinality(languages) <= 5 and private.are_language_codes(languages)),
  over_18_declared_at timestamptz,
  terms_version text,
  terms_accepted_at timestamptz,
  verification_status text not null default 'unverified' check (
    verification_status in ('unverified', 'pending', 'verified', 'requires_input', 'revoked', 'refused')
  ),
  verified_at timestamptz,
  is_over_18 boolean not null default false,
  age_band text check (age_band in ('18-24', '25-34', '35-44', '45-54', '55+')),
  role text not null default 'traveller' check (role in ('traveller', 'admin')),
  account_status text not null default 'active' check (account_status in ('active', 'suspended', 'deleted')),
  created_at timestamptz not null default now()
);

create table public.verification_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null check (provider in ('stripe', 'simulated')),
  provider_session_id text not null unique,
  status text not null check (status in ('requires_input', 'processing', 'verified', 'canceled')),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index verification_sessions_user_id_created_at_idx
  on public.verification_sessions (user_id, created_at);

-- Hostels and stays

create table public.hostels (
  id uuid primary key default gen_random_uuid(),
  name text not null check (private.trimmed_length(name) between 2 and 100 and name is nfc normalized),
  address text not null check (private.trimmed_length(address) between 5 and 200 and address is nfc normalized),
  city text not null check (private.trimmed_length(city) between 1 and 100 and city is nfc normalized),
  country text not null check (private.is_country_code(country)),
  location extensions.geography(Point, 4326) not null,
  timezone text not null check (private.is_time_zone(timezone)),
  website text check (website ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?([/?#]\S*)?$'),
  contact_email text not null check (contact_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  -- International format: a plus, then 7 to 15 digits, with single spaces allowed between them.
  contact_phone text check (contact_phone ~ '^\+[1-9]( ?[0-9]){6,14}$'),
  applicant_role text not null
    check (private.trimmed_length(applicant_role) between 2 and 60 and applicant_role is nfc normalized),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  applied_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index hostels_applied_by_idx on public.hostels (applied_by);

create table public.hostel_staff (
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  staff_role text not null check (staff_role in ('owner', 'staff')),
  primary key (hostel_id, user_id)
);

create index hostel_staff_user_id_idx on public.hostel_staff (user_id);

-- set_stay accepts approved hostels only, which a CHECK can't see.
create table public.stays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  hostel_id uuid not null references public.hostels (id) on delete cascade,
  check_in date not null,
  check_out date not null,
  constraint stays_dates_check check (check_out >= check_in and check_out <= check_in + 30)
);

create index stays_hostel_id_idx on public.stays (hostel_id);

-- Activities and chat

-- host_id has no delete rule, as the data dictionary gives none (open question 24, for T46).
-- approx_location is snapped to the grid by create_activity and update_activity (T25).
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id),
  hostel_id uuid references public.hostels (id),
  title text not null check (private.trimmed_length(title) between 3 and 80 and title is nfc normalized),
  description text
    check (private.trimmed_length(description) <= 1000 and description is nfc normalized),
  category public.activity_category not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null check (private.is_time_zone(timezone)),
  area_label text not null
    check (private.trimmed_length(area_label) between 2 and 60 and area_label is nfc normalized),
  approx_location extensions.geography(Point, 4326) not null,
  max_participants integer not null check (max_participants between 1 and 20),
  cancelled_at timestamptz,
  cancel_reason text
    check (private.trimmed_length(cancel_reason) <= 300 and cancel_reason is nfc normalized),
  time_changed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint activities_times_check check (ends_at > starts_at and ends_at <= starts_at + interval '12 hours')
);

create index activities_approx_location_idx on public.activities using gist (approx_location);
create index activities_starts_at_idx on public.activities (starts_at);
create index activities_host_id_idx on public.activities (host_id);
create index activities_hostel_id_idx on public.activities (hostel_id);

create table public.activity_locations (
  activity_id uuid primary key references public.activities (id) on delete cascade,
  location extensions.geography(Point, 4326) not null,
  meeting_note text
    check (private.trimmed_length(meeting_note) <= 200 and meeting_note is nfc normalized)
);

create table public.activity_participants (
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('joined', 'left', 'removed')),
  joined_at timestamptz not null default now(),
  updated_at timestamptz,
  primary key (activity_id, user_id)
);

create index activity_participants_user_id_idx on public.activity_participants (user_id);

-- Participants insert messages themselves from T41, so the body's CHECK uses built-in functions
-- only, trimming the same characters as private.trimmed_length().
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
  body text not null check (
    char_length(btrim(body,
      E'\t\n\x0b\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
    )) between 1 and 1000
    and body is nfc normalized
  ),
  created_at timestamptz not null default now(),
  removed_at timestamptz
);

create index messages_activity_id_created_at_idx on public.messages (activity_id, created_at);
create index messages_sender_id_idx on public.messages (sender_id);

-- Safety and moderation

-- target_id has no foreign key: one queue covers users, activities and messages (spec §9).
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  target_type text not null check (target_type in ('user', 'activity', 'message')),
  target_id uuid not null,
  reason text not null check (reason in (
    'harassment', 'hate', 'threat_or_violence', 'sexual_content', 'scam_or_spam', 'fake_profile',
    'under_18', 'unsafe_behaviour', 'other'
  )),
  details text check (private.trimmed_length(details) <= 1000 and details is nfc normalized),
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index reports_reporter_id_idx on public.reports (reporter_id);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self_check check (blocker_id <> blocked_id)
);

create index blocks_blocked_id_idx on public.blocks (blocked_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in (
    'participant_joined', 'participant_left', 'participant_removed', 'activity_changed',
    'activity_cancelled', 'reminder_due', 'moderation_decision', 'report_resolved'
  )),
  payload jsonb not null,
  dedupe_key text not null unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_id_idx on public.notifications (user_id);

-- actor_id has no delete rule, as the data dictionary gives none (open question 24).
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles (id),
  action text not null check (action in (
    'approve_hostel', 'reject_hostel', 'dismiss_report', 'remove_message', 'remove_activity',
    'suspend_user', 'revoke_verification', 'uphold_appeal', 'overturn_appeal'
  )),
  target_type text not null check (target_type in ('hostel', 'report', 'message', 'activity', 'user', 'appeal')),
  target_id uuid not null,
  subject_id uuid references public.profiles (id) on delete set null,
  reason text,
  details jsonb,
  created_at timestamptz not null default now(),
  -- Every action that affects someone needs a reason; only these two may go without (DB-MOD-09).
  -- A reason, when there is one, isn't blank, so "no reason" has one form only.
  constraint audit_log_reason_check check (
    (reason is null or (private.trimmed_length(reason) between 1 and 1000 and reason is nfc normalized))
    and (action in ('dismiss_report', 'approve_hostel') or reason is not null)
  )
);

create index audit_log_actor_id_idx on public.audit_log (actor_id);
create index audit_log_subject_id_idx on public.audit_log (subject_id);

create table public.moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  audit_log_id uuid not null references public.audit_log (id),
  reason text not null check (private.trimmed_length(reason) between 10 and 1000 and reason is nfc normalized),
  status text not null default 'open' check (status in ('open', 'upheld', 'overturned')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index moderation_appeals_user_id_idx on public.moderation_appeals (user_id);
-- The partial index allows one open appeal per decision. It doesn't serve the foreign key,
-- because it misses resolved appeals, so the plain index does (DB-SCH-07).
create unique index moderation_appeals_one_open_per_decision
  on public.moderation_appeals (audit_log_id) where status = 'open';
create index moderation_appeals_audit_log_id_idx on public.moderation_appeals (audit_log_id);

-- RLS on every table in public, with no policies yet (DB-SCH-01).
alter table public.profiles enable row level security;
alter table public.verification_sessions enable row level security;
alter table public.hostels enable row level security;
alter table public.hostel_staff enable row level security;
alter table public.stays enable row level security;
alter table public.activities enable row level security;
alter table public.activity_locations enable row level security;
alter table public.activity_participants enable row level security;
alter table public.messages enable row level security;
alter table public.reports enable row level security;
alter table public.blocks enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;
alter table public.moderation_appeals enable row level security;

-- Private schema: reached only by database functions and Edge Functions.

create table private.outbox_events (
  id bigint generated always as identity primary key,
  type text not null check (type in (
    'participant_joined', 'participant_left', 'participant_removed', 'activity_changed',
    'activity_cancelled', 'reminder_due', 'report_created', 'appeal_created', 'hostel_applied',
    'report_resolved', 'moderation_decision', 'account_deleted'
  )),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now()
);

create index outbox_events_status_available_at_idx on private.outbox_events (status, available_at);

create table private.webhook_events (
  id text primary key,
  type text not null,
  status text not null default 'received' check (status in ('received', 'processed', 'failed')),
  attempts integer not null default 0,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table private.rate_limit_buckets (
  user_id uuid not null references public.profiles (id) on delete cascade,
  action text not null check (action in ('join', 'create', 'report', 'message', 'verify', 'export')),
  tokens integer not null check (tokens >= 0),
  refilled_at timestamptz not null,
  primary key (user_id, action)
);

-- Each activity's status and joined count, worked out when read (D13, ADR-008). The first rule
-- that applies wins. It runs as its reader, like every view in public (DB-SCH-01), so a client
-- would count only the participant rows it can see. Clients therefore get no grant on it: only
-- security definer functions read it, and they see every row (open question 8, DB-RLS-34). Every
-- joined row counts, a suspended participant's included.
create view public.activity_status with (security_invoker = true) as
select
  a.id as activity_id,
  case
    when a.cancelled_at <= (select private.now()) then 'cancelled'
    when a.ends_at <= (select private.now()) then 'completed'
    when a.starts_at <= (select private.now()) then 'in_progress'
    when joined.joined_count >= a.max_participants then 'full'
    else 'scheduled'
  end as status,
  joined.joined_count
from public.activities as a
cross join lateral (
  select count(*)::integer as joined_count
  from public.activity_participants as p
  where p.activity_id = a.id and p.status = 'joined'
) as joined;

-- Policy helpers (spec §9, §11). Read-only, security definer with an empty search_path, and
-- the caller always comes from auth.uid(), so a policy can't ask about anyone else. They count
-- only active accounts (open question 10).

-- The caller has joined the activity and hasn't left, been removed or been suspended.
create function private.is_participant(activity_id uuid) returns boolean
  language sql stable security definer
  set search_path = ''
begin atomic
  select exists (
    select 1
    from public.activity_participants as p
    join public.profiles as caller on caller.id = p.user_id
    where p.activity_id = is_participant.activity_id
      and p.user_id = (select auth.uid())
      and p.status = 'joined'
      and caller.account_status = 'active'
  );
end;

-- The caller is an active admin.
create function private.is_admin() returns boolean
  language sql stable security definer
  set search_path = ''
begin atomic
  select exists (
    select 1
    from public.profiles as caller
    where caller.id = (select auth.uid()) and caller.role = 'admin' and caller.account_status = 'active'
  );
end;

-- A block exists between the caller and the other person, whichever of them made it. With no
-- session it answers true, so a policy's "not blocked" branch fails closed. The answer doesn't
-- say which way round, but the caller knows their own blocks, so this isn't what keeps a block
-- secret. Policies do that by hiding a blocked person exactly as they hide a suspended, deleted
-- or unknown account, and by passing only ids of rows the caller can already read (open
-- question 12).
create function private.is_blocked(other_user_id uuid) returns boolean
  language sql stable security definer
  set search_path = ''
begin atomic
  select (select auth.uid()) is null or exists (
    select 1
    from public.blocks as b
    where (b.blocker_id = (select auth.uid()) and b.blocked_id = is_blocked.other_user_id)
      or (b.blocker_id = is_blocked.other_user_id and b.blocked_id = (select auth.uid()))
  );
end;

-- Policies, views and caller-rights read functions call these as the caller. authenticated
-- still can't call them itself, because it can't use the private schema (DB-SCH-02, DB-SCH-04).
grant execute on function
  private.is_participant(uuid), private.is_admin(), private.is_blocked(uuid), private.now()
  to authenticated;

-- Profile photos, one folder per user (spec §11 input rules). The storage policies come with
-- the upload, in T18. 2 MB is 2,097,152 bytes, which T12 and T18 check too. The bucket checks
-- the type the uploader declares; T18 checks the file's contents.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']);
