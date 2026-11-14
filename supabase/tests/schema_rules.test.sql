-- The data dictionary's rules, enforced by the database itself (test specification §3.1).
-- DB-SCH-05 covers every CHECK in the dictionary, with a refusing case for each rule and passing
-- cases at the edges. DB-SCH-06 covers every primary and unique key.
-- The rows are made here, since the seed cast arrives with T09.
begin;
create extension if not exists pgtap with schema extensions;

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'one@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'two@example.com');
insert into public.profiles (id) values
  ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222')
  on conflict (id) do nothing;
insert into public.verification_sessions (user_id, provider, provider_session_id, status) values
  ('11111111-1111-4111-8111-111111111111', 'simulated', 'sim_one', 'verified');
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
insert into public.activity_locations (activity_id, location) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'SRID=4326;POINT(-9.1312 38.7105)');
insert into public.activity_participants (activity_id, user_id, status) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'joined');
insert into public.messages (id, activity_id, sender_id, body) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   '22222222-2222-4222-8222-222222222222', 'See you there');
insert into public.reports (id, reporter_id, target_type, target_id, reason) values
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', '22222222-2222-4222-8222-222222222222', 'user',
   '11111111-1111-4111-8111-111111111111', 'other');
insert into public.blocks (blocker_id, blocked_id) values
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111');
insert into public.notifications (user_id, type, payload, dedupe_key) values
  ('11111111-1111-4111-8111-111111111111', 'participant_joined', '{}', 'joined:one');
insert into public.audit_log (id, actor_id, action, target_type, target_id, subject_id, reason) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '11111111-1111-4111-8111-111111111111', 'suspend_user',
   'user', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222',
   'Repeated harassment');
insert into public.moderation_appeals (user_id, audit_log_id, reason) values
  ('22222222-2222-4222-8222-222222222222', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   'I didn''t send those messages');
insert into private.outbox_events (type, payload) values ('participant_joined', '{}');
insert into private.webhook_events (id, type) values ('evt_one', 'identity.verification_session.verified');
insert into private.rate_limit_buckets (user_id, action, tokens, refilled_at) values
  ('11111111-1111-4111-8111-111111111111', 'join', 10, now());

-- Each statement must fail on the named constraint.
create temporary table refusals (n serial, description text, statement text, constraint_name text);

insert into refusals (description, statement, constraint_name) values
  -- The four cases DB-SCH-05 names.
  ('DB-SCH-05 an end before the start',
   $$ update public.activities set ends_at = starts_at - interval '1 minute' $$, 'activities_times_check'),
  ('DB-SCH-05 a group size of 0',
   $$ update public.activities set max_participants = 0 $$, 'activities_max_participants_check'),
  ('DB-SCH-05 a group size of 21',
   $$ update public.activities set max_participants = 21 $$, 'activities_max_participants_check'),
  ('DB-SCH-05 a check-out before the check-in',
   $$ update public.stays set check_out = check_in - 1 $$, 'stays_dates_check'),
  ('DB-SCH-05 blocking yourself',
   $$ insert into public.blocks (blocker_id, blocked_id) values
      ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111') $$,
   'blocks_not_self_check'),

  -- profiles
  ('DB-SCH-05 profiles: an empty display name',
   $$ update public.profiles set display_name = '' $$, 'profiles_display_name_check'),
  ('DB-SCH-05 profiles: a display name of only spaces',
   $$ update public.profiles set display_name = '   ' $$, 'profiles_display_name_check'),
  ('DB-SCH-05 profiles: a display name of only no-break and ideographic spaces',
   $$ update public.profiles set display_name = chr(160) || chr(12288) $$, 'profiles_display_name_check'),
  ('DB-SCH-05 profiles: a display name of 41 characters',
   $$ update public.profiles set display_name = repeat('a', 41) $$, 'profiles_display_name_check'),
  ('DB-SCH-05 profiles: a control character in a display name',
   $$ update public.profiles set display_name = 'Ana' || chr(7) $$, 'profiles_display_name_check'),
  ('DB-SCH-05 profiles: a zero-width space in a display name',
   $$ update public.profiles set display_name = 'An' || chr(8203) || 'a' $$, 'profiles_display_name_check'),
  ('DB-SCH-05 profiles: a right-to-left override in a display name',
   $$ update public.profiles set display_name = 'An' || chr(8238) || 'a' $$, 'profiles_display_name_check'),
  ('DB-SCH-05 profiles: an Arabic letter mark in a display name',
   $$ update public.profiles set display_name = 'An' || chr(1564) || 'a' $$, 'profiles_display_name_check'),
  ('DB-SCH-05 profiles: a line separator inside a display name',
   $$ update public.profiles set display_name = 'An' || chr(8232) || 'a' $$, 'profiles_display_name_check'),
  ('DB-SCH-05 profiles: an invisible format character in a display name',
   $$ update public.profiles set display_name = 'An' || chr(8298) || 'a' $$, 'profiles_display_name_check'),
  ('DB-SCH-05 profiles: an annotation character in a display name',
   $$ update public.profiles set display_name = 'An' || chr(65529) || 'a' $$, 'profiles_display_name_check'),
  ('DB-SCH-05 profiles: a display name of only a Hangul filler, which looks blank',
   $$ update public.profiles set display_name = chr(12644) $$, 'profiles_display_name_check'),
  ('DB-SCH-05 profiles: a display name of only blank braille',
   $$ update public.profiles set display_name = chr(10240) || chr(10240) $$, 'profiles_display_name_check'),
  ('DB-SCH-05 profiles: a zero-width joiner at the start of a display name',
   $$ update public.profiles set display_name = chr(8205) || 'Ana' $$, 'profiles_display_name_check'),
  ('DB-SCH-05 profiles: a zero-width non-joiner at the end of a display name',
   $$ update public.profiles set display_name = 'Ana' || chr(8204) $$, 'profiles_display_name_check'),
  ('DB-SCH-05 profiles: a zero-width joiner beside a space',
   $$ update public.profiles set display_name = 'An ' || chr(8205) || 'a' $$, 'profiles_display_name_check'),
  ('DB-SCH-05 profiles: two zero-width joiners together',
   $$ update public.profiles set display_name = 'An' || chr(8205) || chr(8205) || 'a' $$, 'profiles_display_name_check'),
  ('DB-SCH-05 profiles: a tag character outside a flag',
   $$ update public.profiles set display_name = 'Ana' || chr(917607) $$, 'profiles_display_name_check'),
  ('DB-SCH-05 profiles: a flag''s tag characters without its closing tag',
   $$ update public.profiles set display_name = 'Ana ' || chr(127988) || chr(917607) || chr(917602) $$,
   'profiles_display_name_check'),
  ('DB-SCH-05 profiles: a display name not in NFC form',
   $$ update public.profiles set display_name = 'Jose' || chr(769) $$, 'profiles_display_name_check'),
  ('DB-SCH-05 profiles: a bio of 301 characters',
   $$ update public.profiles set bio = repeat('a', 301) $$, 'profiles_bio_check'),
  ('DB-SCH-05 profiles: a lower-case country code',
   $$ update public.profiles set home_country = 'pt' $$, 'profiles_home_country_check'),
  ('DB-SCH-05 profiles: a three-letter country code',
   $$ update public.profiles set home_country = 'PRT' $$, 'profiles_home_country_check'),
  ('DB-SCH-05 profiles: a country code ISO hasn''t assigned',
   $$ update public.profiles set home_country = 'ZZ' $$, 'profiles_home_country_check'),
  ('DB-SCH-05 profiles: XK, which ISO hasn''t assigned',
   $$ update public.profiles set home_country = 'XK' $$, 'profiles_home_country_check'),
  ('DB-SCH-05 profiles: a language code ISO 639-1 doesn''t have',
   $$ update public.profiles set languages = '{en,zz}' $$, 'profiles_languages_check'),
  ('DB-SCH-05 profiles: sh, a withdrawn language code',
   $$ update public.profiles set languages = '{sh}' $$, 'profiles_languages_check'),
  ('DB-SCH-05 profiles: languages as a two-dimensional array',
   $$ update public.profiles set languages = '{{en},{pt}}' $$, 'profiles_languages_check'),
  ('DB-SCH-05 profiles: six languages',
   $$ update public.profiles set languages = '{en,pt,es,fr,de,it}' $$, 'profiles_languages_check'),
  ('DB-SCH-05 profiles: a duplicate language',
   $$ update public.profiles set languages = '{en,en}' $$, 'profiles_languages_check'),
  ('DB-SCH-05 profiles: an upper-case language code',
   $$ update public.profiles set languages = '{EN}' $$, 'profiles_languages_check'),
  ('DB-SCH-05 profiles: a missing language code',
   $$ update public.profiles set languages = '{en,NULL}' $$, 'profiles_languages_check'),
  ('DB-SCH-05 profiles: a photo in another user''s folder',
   $$ update public.profiles set avatar_path = '22222222-2222-4222-8222-222222222222/photo.webp'
      where id = '11111111-1111-4111-8111-111111111111' $$, 'profiles_avatar_path_check'),
  ('DB-SCH-05 profiles: a photo in a folder below the user''s own',
   $$ update public.profiles set avatar_path = '11111111-1111-4111-8111-111111111111/a/photo.webp'
      where id = '11111111-1111-4111-8111-111111111111' $$, 'profiles_avatar_path_check'),
  ('DB-SCH-05 profiles: a photo path climbing out of the folder',
   $$ update public.profiles set avatar_path = '11111111-1111-4111-8111-111111111111/..'
      where id = '11111111-1111-4111-8111-111111111111' $$, 'profiles_avatar_path_check'),
  ('DB-SCH-05 profiles: an unknown verification status',
   $$ update public.profiles set verification_status = 'approved' $$, 'profiles_verification_status_check'),
  ('DB-SCH-05 profiles: an unknown age band',
   $$ update public.profiles set age_band = '18-25' $$, 'profiles_age_band_check'),
  ('DB-SCH-05 profiles: an unknown role',
   $$ update public.profiles set role = 'moderator' $$, 'profiles_role_check'),
  ('DB-SCH-05 profiles: an unknown account status',
   $$ update public.profiles set account_status = 'banned' $$, 'profiles_account_status_check'),

  -- verification_sessions
  ('DB-SCH-05 verification_sessions: an unknown provider',
   $$ update public.verification_sessions set provider = 'onfido' $$, 'verification_sessions_provider_check'),
  ('DB-SCH-05 verification_sessions: an unknown status',
   $$ update public.verification_sessions set status = 'failed' $$, 'verification_sessions_status_check'),

  -- hostels
  ('DB-SCH-05 hostels: a name of 1 character',
   $$ update public.hostels set name = 'H' $$, 'hostels_name_check'),
  ('DB-SCH-05 hostels: a name of 101 characters',
   $$ update public.hostels set name = repeat('h', 101) $$, 'hostels_name_check'),
  ('DB-SCH-05 hostels: an address of 4 characters',
   $$ update public.hostels set address = 'Rua1' $$, 'hostels_address_check'),
  ('DB-SCH-05 hostels: an address of 201 characters',
   $$ update public.hostels set address = repeat('a', 201) $$, 'hostels_address_check'),
  ('DB-SCH-05 hostels: a city of only spaces',
   $$ update public.hostels set city = '  ' $$, 'hostels_city_check'),
  ('DB-SCH-05 hostels: a city of 101 characters',
   $$ update public.hostels set city = repeat('c', 101) $$, 'hostels_city_check'),
  ('DB-SCH-05 hostels: a lower-case country code',
   $$ update public.hostels set country = 'pt' $$, 'hostels_country_check'),
  ('DB-SCH-05 hostels: an unknown time zone',
   $$ update public.hostels set timezone = 'Europe/Atlantis' $$, 'hostels_timezone_check'),
  ('DB-SCH-05 hostels: a country code ISO hasn''t assigned',
   $$ update public.hostels set country = 'XX' $$, 'hostels_country_check'),
  ('DB-SCH-05 hostels: a posix/ copy of a time zone',
   $$ update public.hostels set timezone = 'posix/Europe/Lisbon' $$, 'hostels_timezone_check'),
  ('DB-SCH-05 hostels: a right/ copy of a time zone',
   $$ update public.hostels set timezone = 'right/Europe/Lisbon' $$, 'hostels_timezone_check'),
  ('DB-SCH-05 hostels: posixrules, which isn''t a zone',
   $$ update public.hostels set timezone = 'posixrules' $$, 'hostels_timezone_check'),
  ('DB-SCH-05 hostels: localtime, which isn''t a zone',
   $$ update public.hostels set timezone = 'localtime' $$, 'hostels_timezone_check'),
  ('DB-SCH-05 hostels: Factory, which isn''t a zone',
   $$ update public.hostels set timezone = 'Factory' $$, 'hostels_timezone_check'),
  ('DB-SCH-05 hostels: a website on http://',
   $$ update public.hostels set website = 'http://hostel.example' $$, 'hostels_website_check'),
  ('DB-SCH-05 hostels: a website with no scheme',
   $$ update public.hostels set website = 'hostel.example' $$, 'hostels_website_check'),
  ('DB-SCH-05 hostels: a website with a space',
   $$ update public.hostels set website = 'https://hostel.example/a page' $$, 'hostels_website_check'),
  ('DB-SCH-05 hostels: a contact email with no @',
   $$ update public.hostels set contact_email = 'desk.example.com' $$, 'hostels_contact_email_check'),
  ('DB-SCH-05 hostels: a phone number in national format',
   $$ update public.hostels set contact_phone = '021 000 0000' $$, 'hostels_contact_phone_check'),
  ('DB-SCH-05 hostels: a phone number that''s too short',
   $$ update public.hostels set contact_phone = '+351 21' $$, 'hostels_contact_phone_check'),
  ('DB-SCH-05 hostels: an applicant role of 1 character',
   $$ update public.hostels set applicant_role = 'x' $$, 'hostels_applicant_role_check'),
  ('DB-SCH-05 hostels: an applicant role of 61 characters',
   $$ update public.hostels set applicant_role = repeat('r', 61) $$, 'hostels_applicant_role_check'),
  ('DB-SCH-05 hostels: an unknown status',
   $$ update public.hostels set status = 'closed' $$, 'hostels_status_check'),
  ('DB-SCH-05 hostel_staff: an unknown staff role',
   $$ update public.hostel_staff set staff_role = 'manager' $$, 'hostel_staff_staff_role_check'),
  ('DB-SCH-05 stays: 31 nights',
   $$ update public.stays set check_out = check_in + 31 $$, 'stays_dates_check'),

  -- activities and chat
  ('DB-SCH-05 activities: an end equal to the start',
   $$ update public.activities set ends_at = starts_at $$, 'activities_times_check'),
  ('DB-SCH-05 activities: an end 12 hours and 1 second after the start',
   $$ update public.activities set ends_at = starts_at + interval '12 hours 1 second' $$, 'activities_times_check'),
  ('DB-SCH-05 activities: a title of 2 characters',
   $$ update public.activities set title = 'Go' $$, 'activities_title_check'),
  ('DB-SCH-05 activities: a title of 81 characters',
   $$ update public.activities set title = repeat('t', 81) $$, 'activities_title_check'),
  ('DB-SCH-05 activities: a description of 1,001 characters',
   $$ update public.activities set description = repeat('d', 1001) $$, 'activities_description_check'),
  ('DB-SCH-05 activities: an unknown time zone',
   $$ update public.activities set timezone = 'Europe/Atlantis' $$, 'activities_timezone_check'),
  ('DB-SCH-05 activities: an area label of 1 character',
   $$ update public.activities set area_label = 'A' $$, 'activities_area_label_check'),
  ('DB-SCH-05 activities: an area label of 61 characters',
   $$ update public.activities set area_label = repeat('a', 61) $$, 'activities_area_label_check'),
  ('DB-SCH-05 activities: a cancellation reason of 301 characters',
   $$ update public.activities set cancel_reason = repeat('r', 301) $$, 'activities_cancel_reason_check'),
  ('DB-SCH-05 activity_locations: a meeting note of 201 characters',
   $$ update public.activity_locations set meeting_note = repeat('m', 201) $$, 'activity_locations_meeting_note_check'),
  ('DB-SCH-05 activity_participants: an unknown status',
   $$ update public.activity_participants set status = 'waiting' $$, 'activity_participants_status_check'),
  ('DB-SCH-05 messages: an empty body',
   $$ update public.messages set body = '' $$, 'messages_body_check'),
  ('DB-SCH-05 messages: a body of only spaces, tabs and new lines',
   $$ update public.messages set body = E' \t\n\r ' $$, 'messages_body_check'),
  ('DB-SCH-05 messages: a body of only no-break and ideographic spaces',
   $$ update public.messages set body = chr(160) || chr(12288) || chr(65279) $$, 'messages_body_check'),
  ('DB-SCH-05 messages: a body of 1,001 characters',
   $$ update public.messages set body = repeat('m', 1001) $$, 'messages_body_check'),
  ('DB-SCH-05 messages: a body not in NFC form',
   $$ update public.messages set body = 'cafe' || chr(769) $$, 'messages_body_check'),

  -- safety and moderation
  ('DB-SCH-05 reports: an unknown target type',
   $$ update public.reports set target_type = 'hostel' $$, 'reports_target_type_check'),
  ('DB-SCH-05 reports: a reason not on the list',
   $$ update public.reports set reason = 'rude' $$, 'reports_reason_check'),
  ('DB-SCH-05 reports: details of 1,001 characters',
   $$ update public.reports set details = repeat('d', 1001) $$, 'reports_details_check'),
  ('DB-SCH-05 reports: an unknown status',
   $$ update public.reports set status = 'closed' $$, 'reports_status_check'),
  ('DB-SCH-05 notifications: an unknown type',
   $$ update public.notifications set type = 'marketing' $$, 'notifications_type_check'),
  ('DB-SCH-05 audit_log: an unknown action',
   $$ update public.audit_log set action = 'delete_user' $$, 'audit_log_action_check'),
  ('DB-SCH-05 audit_log: an unknown target type',
   $$ update public.audit_log set target_type = 'profile' $$, 'audit_log_target_type_check'),
  ('DB-SCH-05 audit_log: no reason for an action that affects someone',
   $$ update public.audit_log set reason = null $$, 'audit_log_reason_check'),
  ('DB-SCH-05 audit_log: a blank reason for an action that affects someone',
   $$ update public.audit_log set reason = '   ' $$, 'audit_log_reason_check'),
  ('DB-SCH-05 audit_log: a reason of 1,001 characters',
   $$ update public.audit_log set reason = repeat('r', 1001) $$, 'audit_log_reason_check'),
  ('DB-SCH-05 audit_log: a blank reason, even for dismissing a report',
   $$ insert into public.audit_log (actor_id, action, target_type, target_id, reason) values
      ('11111111-1111-4111-8111-111111111111', 'dismiss_report', 'report', 'ffffffff-ffff-4fff-8fff-ffffffffffff', '  ') $$,
   'audit_log_reason_check'),
  ('DB-SCH-05 moderation_appeals: a reason of 9 characters',
   $$ update public.moderation_appeals set reason = 'Not me!!!' $$, 'moderation_appeals_reason_check'),
  ('DB-SCH-05 moderation_appeals: a reason of 1,001 characters',
   $$ update public.moderation_appeals set reason = repeat('r', 1001) $$, 'moderation_appeals_reason_check'),
  ('DB-SCH-05 moderation_appeals: an unknown status',
   $$ update public.moderation_appeals set status = 'closed' $$, 'moderation_appeals_status_check'),

  -- private
  ('DB-SCH-05 outbox_events: a type not in spec section 11',
   $$ update private.outbox_events set type = 'email_sent' $$, 'outbox_events_type_check'),
  ('DB-SCH-05 outbox_events: an unknown status',
   $$ update private.outbox_events set status = 'done' $$, 'outbox_events_status_check'),
  ('DB-SCH-05 webhook_events: an unknown status',
   $$ update private.webhook_events set status = 'ignored' $$, 'webhook_events_status_check'),
  ('DB-SCH-05 rate_limit_buckets: an unknown action',
   $$ update private.rate_limit_buckets set action = 'login' $$, 'rate_limit_buckets_action_check'),
  ('DB-SCH-05 rate_limit_buckets: fewer than 0 tokens',
   $$ update private.rate_limit_buckets set tokens = -1 $$, 'rate_limit_buckets_tokens_check'),

  -- DB-SCH-06: the keys.
  ('DB-SCH-06 a duplicate participant',
   $$ insert into public.activity_participants (activity_id, user_id, status) values
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'joined') $$,
   'activity_participants_pkey'),
  ('DB-SCH-06 a duplicate block',
   $$ insert into public.blocks (blocker_id, blocked_id) values
      ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111') $$,
   'blocks_pkey'),
  ('DB-SCH-06 a duplicate staff entry',
   $$ insert into public.hostel_staff (hostel_id, user_id, staff_role) values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'staff') $$,
   'hostel_staff_pkey'),
  ('DB-SCH-06 a duplicate notification dedupe_key',
   $$ insert into public.notifications (user_id, type, payload, dedupe_key) values
      ('22222222-2222-4222-8222-222222222222', 'reminder_due', '{}', 'joined:one') $$,
   'notifications_dedupe_key_key'),
  ('DB-SCH-06 a second stay for the same user',
   $$ insert into public.stays (user_id, hostel_id, check_in, check_out) values
      ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2027-02-01', '2027-02-02') $$,
   'stays_user_id_key'),
  ('DB-SCH-06 a duplicate provider session id',
   $$ insert into public.verification_sessions (user_id, provider, provider_session_id, status) values
      ('22222222-2222-4222-8222-222222222222', 'simulated', 'sim_one', 'processing') $$,
   'verification_sessions_provider_session_id_key'),
  ('DB-SCH-06 a second open appeal against the same decision',
   $$ insert into public.moderation_appeals (user_id, audit_log_id, reason) values
      ('22222222-2222-4222-8222-222222222222', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Please look again at this') $$,
   'moderation_appeals_one_open_per_decision'),
  ('DB-SCH-06 a repeated Stripe event',
   $$ insert into private.webhook_events (id, type) values ('evt_one', 'identity.verification_session.verified') $$,
   'webhook_events_pkey'),
  ('DB-SCH-06 a second bucket for the same user and action',
   $$ insert into private.rate_limit_buckets (user_id, action, tokens, refilled_at) values
      ('11111111-1111-4111-8111-111111111111', 'join', 5, now()) $$,
   'rate_limit_buckets_pkey');

-- Text in decomposed form ("Cafe" plus a combining acute accent) in every column that must be
-- stored in NFC. display_name and messages.body have their own cases above.
insert into refusals (description, statement, constraint_name)
select
  format('DB-SCH-05 %s: %s not in NFC form', target.table_name, target.column_name),
  format('update %s set %I = %L', target.table_name, target.column_name, 'Cafe' || chr(769) || ' by the river'),
  target.constraint_name
from (values
  ('public.profiles', 'bio', 'profiles_bio_check'),
  ('public.hostels', 'name', 'hostels_name_check'),
  ('public.hostels', 'address', 'hostels_address_check'),
  ('public.hostels', 'city', 'hostels_city_check'),
  ('public.hostels', 'applicant_role', 'hostels_applicant_role_check'),
  ('public.activities', 'title', 'activities_title_check'),
  ('public.activities', 'description', 'activities_description_check'),
  ('public.activities', 'area_label', 'activities_area_label_check'),
  ('public.activities', 'cancel_reason', 'activities_cancel_reason_check'),
  ('public.activity_locations', 'meeting_note', 'activity_locations_meeting_note_check'),
  ('public.reports', 'details', 'reports_details_check'),
  ('public.audit_log', 'reason', 'audit_log_reason_check'),
  ('public.moderation_appeals', 'reason', 'moderation_appeals_reason_check')
) as target (table_name, column_name, constraint_name);

-- Each statement must succeed: the edges of the rules above, and text the rules must allow.
create temporary table acceptances (n serial, description text, statement text);

insert into acceptances (description, statement) values
  ('DB-SCH-05 a group size of 1', $$ update public.activities set max_participants = 1 $$),
  ('DB-SCH-05 a group size of 20', $$ update public.activities set max_participants = 20 $$),
  ('DB-SCH-05 an end exactly 12 hours after the start',
   $$ update public.activities set ends_at = starts_at + interval '12 hours' $$),
  ('DB-SCH-05 a stay of 0 nights', $$ update public.stays set check_out = check_in $$),
  ('DB-SCH-05 a stay of 30 nights', $$ update public.stays set check_out = check_in + 30 $$),
  ('DB-SCH-05 profiles: a display name of 1 character', $$ update public.profiles set display_name = 'A' $$),
  ('DB-SCH-05 profiles: a display name of 40 characters, counted after trimming',
   $$ update public.profiles set display_name = '  ' || repeat('a', 40) || '  ' $$),
  ('DB-SCH-05 profiles: emoji, accents and right-to-left text in a display name',
   $$ update public.profiles set display_name = 'Zoë 🌍 سارة' $$),
  ('DB-SCH-05 profiles: a zero-width non-joiner between letters, as in the Persian name Alireza',
   $$ update public.profiles set display_name = 'علی' || chr(8204) || 'رضا' $$),
  ('DB-SCH-05 profiles: a zero-width joiner inside a Sinhala word',
   $$ update public.profiles set display_name = chr(3521) || chr(3530) || chr(8205) || chr(3515) || chr(3539) $$),
  ('DB-SCH-05 profiles: an emoji joined by a zero-width joiner (woman technologist)',
   $$ update public.profiles set display_name = 'Ana ' || chr(128105) || chr(8205) || chr(128187) $$),
  ('DB-SCH-05 profiles: the rainbow flag, joined after a variation selector',
   $$ update public.profiles set display_name = 'Ana ' || chr(127987) || chr(65039) || chr(8205) || chr(127752) $$),
  ('DB-SCH-05 profiles: the flag of England, made of tag characters',
   $$ update public.profiles set display_name = 'Ana ' || chr(127988) || chr(917607) || chr(917602)
      || chr(917605) || chr(917614) || chr(917607) || chr(917631) $$),
  ('DB-SCH-05 profiles: an assigned country code', $$ update public.profiles set home_country = 'GB' $$),
  ('DB-SCH-05 profiles: five languages', $$ update public.profiles set languages = '{en,pt,es,fr,de}' $$),
  ('DB-SCH-05 profiles: no languages', $$ update public.profiles set languages = '{}' $$),
  ('DB-SCH-05 profiles: a photo in the user''s own folder',
   $$ update public.profiles set avatar_path = '11111111-1111-4111-8111-111111111111/photo.webp'
      where id = '11111111-1111-4111-8111-111111111111' $$),
  ('DB-SCH-05 hostels: a three-part time zone',
   $$ update public.hostels set timezone = 'America/Argentina/Buenos_Aires' $$),
  ('DB-SCH-05 hostels: an https:// website with a path',
   $$ update public.hostels set website = 'https://hostel.example/en/rooms?lang=en' $$),
  ('DB-SCH-05 hostels: a phone number in international format',
   $$ update public.hostels set contact_phone = '+351 21 000 0000' $$),
  ('DB-SCH-05 messages: a body of 1,000 characters', $$ update public.messages set body = repeat('m', 1000) $$),
  ('DB-SCH-05 audit_log: dismissing a report with no reason',
   $$ insert into public.audit_log (actor_id, action, target_type, target_id) values
      ('11111111-1111-4111-8111-111111111111', 'dismiss_report', 'report', 'ffffffff-ffff-4fff-8fff-ffffffffffff') $$),
  ('DB-SCH-05 audit_log: approving a hostel with no reason',
   $$ insert into public.audit_log (actor_id, action, target_type, target_id) values
      ('11111111-1111-4111-8111-111111111111', 'approve_hostel', 'hostel', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$),
  ('DB-SCH-06 a new appeal against a decision once the earlier one is resolved',
   $$ update public.moderation_appeals set status = 'upheld', resolved_at = now();
      insert into public.moderation_appeals (user_id, audit_log_id, reason) values
      ('22222222-2222-4222-8222-222222222222', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'New evidence this time') $$);

select plan((select count(*)::integer from refusals) + (select count(*)::integer from acceptances));

select throws_like(statement, '%"' || constraint_name || '"%', description) from refusals order by n;
select lives_ok(statement, description) from acceptances order by n;

select * from finish();
rollback;
