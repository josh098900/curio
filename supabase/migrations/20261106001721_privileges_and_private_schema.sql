-- The first migration: nothing is reachable by default (spec §9, ADR-003).
--
-- Postgres lets every role run a new function, and Supabase also grants new functions, tables
-- and sequences in public to the Data API's roles. These revokes cover what postgres creates,
-- which is everything a migration creates, so a client reaches a function or table only
-- through a grant in the migration that creates it. Tables and sequences match the hosted
-- projects, which were created with "Automatically expose new tables" off. Objects that
-- extensions create keep Supabase's own defaults, which postgres can't change, so extensions
-- go in the extensions schema (DB-SCH-09).
alter default privileges for role postgres revoke execute on functions from public;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;

-- Policy helpers, the server-only functions in spec §11, the webhook inbox, the outbox and
-- the rate-limit buckets. The Data API doesn't expose it, and its roles can't use it.
create schema private;
