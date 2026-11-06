---
paths:
  - "supabase/**"
---

# Database and Edge Function rules

Read these with spec §8.5, §9, §11 (interface contracts), §13, §14.4 and §14.5, the data dictionary, and sections 3 and 4 of the test specification.

## Migrations

- Every change is a new file made with `pnpm supabase migration new <name>`. A migration counts as applied once it's merged into `main`: from then on, never edit, rename or delete it (a hook enforces this). Fix forward with a new migration. One committed only on an unmerged branch can still change.
- Never change a database by hand, through the dashboard or with remote CLI commands outside a task that says so. CI applies migrations to staging, and to production after approval.
- Keep the first migration's revokes: Postgres's default `execute` privilege on functions, and Supabase's default grants of new functions, tables and sequences in `public`.
- If a change needs a table, column, value or index the data dictionary doesn't list, stop and ask. The dictionary changes first.

## Schema

The data dictionary's conventions, which are applied everywhere:

- Ids are `uuid default gen_random_uuid()`, except the outbox's generated `bigint` and Stripe's own event ids.
- Times are `timestamptz`, stored in UTC. Positions are `geography(Point, 4326)` with GiST indexes.
- Allowed values are `text` columns with a CHECK constraint. The only enum type is `activity_category`.
- Columns are `not null` unless the dictionary says optional.
- Lengths count characters after trimming, not bytes. Text is stored in NFC form.
- Foreign keys cascade or set null exactly as the dictionary says. Every foreign key has an index that starts with its column, unless a primary or unique key already does; a partial index doesn't count (DB-SCH-07).
- `approx_location` is snapped to a fixed grid of about 1 km, deterministically, never randomly offset. The exact point exists only in `activity_locations`.
- Activity status comes from the `activity_status` view. Only cancellation is stored.
- Views in `public` are `security_invoker`, so RLS applies through them. No materialized views or foreign tables in `public` (DB-SCH-01).
- `outbox_events`, `webhook_events`, `rate_limit_buckets` and every helper function live in `private`, which the Data API never exposes.
- Extensions go in the `extensions` schema (`create extension … with schema extensions`), never `public` or `private` (DB-SCH-09).

## Access rules (RLS)

- Every table in `public` has RLS on (DB-SCH-01), with the rules in spec §9's access table.
- Policies name their role (`to authenticated`), wrap `(select auth.uid())`, and index every column they filter on.
- Where §9 says a table is written "through" a function, clients get no insert, update or delete policy on it. Columns the dictionary marks server only are written only by functions.
- Policy helpers (`private.is_participant`, `private.is_admin`, `private.is_blocked`) are read-only, `security definer` and `set search_path = ''`, with every name schema-qualified. They read the caller from `(select auth.uid())`, never from a parameter, so a policy can't be used to ask about other people. Pass them only columns of rows the caller can already read, never a function's own parameter: a public read function calling `private.is_blocked(<parameter>)` would tell anyone who has blocked them.
- Blocks hide people both ways and never reveal who blocked whom. Suspended and deleted accounts are hidden from everyone but admins.

## RPC functions

- Follow the interface contract in §11 to the letter: the parameters, the checks in the order listed, stopping at the first that fails, and only the errors listed for that function.
- Raise errors only through `private.raise_error(code, details)`, never with `raise exception` directly. The code is the message, the HTTP status comes from §14.4 through PostgREST's `PT` codes, and `INVALID_INPUT` carries the field details. DB-SCH-08 fails the build on any other code.
- Each function runs in one transaction. A refusal raises, so nothing partial is written and no rate-limit token is used (DB-RATE-06). Calling again with the same arguments never repeats an effect.
- Rate-limited actions call `private.consume_rate_limit(user_id, action)` where the contract puts it.
- Client roles can't use the `private` schema (DB-SCH-04), and a PL/pgSQL function running as the caller can't call into it. So functions and triggers that write, or that need PL/pgSQL, are `security definer`: set `search_path = ''`, check the caller inside, filter what you return as RLS would, and qualify every name (DB-SCH-03). Read-only functions that should respect RLS run as the caller and are SQL with `begin atomic` bodies, which resolve names when they're created; they raise errors through `private.raise_error`.
- Public RPC functions are granted to `authenticated` only, except `public.health()`, which reads nothing and only `anon` can run, for the health check (DB-HLT-01). In `private`, `authenticated` gets `execute` only on what policies, views and those read functions call: the three policy helpers, `private.now()` and `private.raise_error()`. It still can't call them, because it can't use the schema. A new function goes on the DB-SCH-02 allow-list in `supabase/tests/schema_guards.test.sql` in the same change.
- Business rules read the time from `private.now()`, never `now()` directly.
- Side effects go into `private.outbox_events` in the same transaction, with ids only in the payload and only the event types in §11. Consumers are idempotent: emails use the outbox event id as the idempotency key, notifications a unique `dedupe_key`.
- Admin functions check `private.is_admin()` and write their `audit_log` row in the same transaction (DB-MOD-07). Every action that affects someone needs a reason, which that person sees; only dismissing a report and approving a hostel may go without (DB-MOD-09). Admins' own notes go in `details`, which only admins read. `resolve_report` also writes a `report_resolved` event for the reporter, with the report's id only (DB-MOD-08). The dispatcher looks up the outcome and stores it in the reporter's notification, because reporters can't read reports.
- Realtime notices carry ids only (`realtime.send`), never message text or personal data.

## Edge Functions (`supabase/functions`)

- There are four: `verification`, `stripe-webhook`, `dispatcher` and `export-data`. Each accepts exactly one kind of credential, as §11 lists: a user JWT, the `cron` secret key, or Stripe's signature, with `verify_jwt` set to match.
- Secrets come from Edge Function secrets through `Deno.env`. Never log, return or store them.
- Reach Stripe and Resend only through the providers in `_shared`, chosen by `VERIFICATION_PROVIDER` and `EMAIL_MODE`. Handlers never import Stripe or Resend directly.
- Stripe: sandbox only, the Identity-restricted key, idempotency keys on anything that creates, and a timeout on every call. `stripe-webhook` checks the signature on the raw body, stores the event, replies 200, then processes it in the background after re-reading the session from Stripe.
- A date of birth exists only in memory. It never reaches a column, a log line or Sentry (EF-WH-10).
- A function acting for a user uses the caller's JWT, so RLS applies. A function that needs `private` uses the direct pooled connection, which runs in transaction mode, so no prepared statements (D27).
- Call only the fixed Stripe and Resend addresses. Never fetch a URL taken from input.
- Errors to the web and iOS apps use the codes and HTTP statuses in §14.4, in the same JSON body as a database error (the code as `message`, field errors in `details`), built by one helper in `_shared` (UT-ERR-05). A Stripe or Resend failure becomes `UNAVAILABLE`; never pass a provider's error through. `stripe-webhook` answers Stripe with 200 or 400 only.
- Logs are structured JSON with the request id, and contain no names, email addresses, locations or message text.

## Tests (`supabase/tests`)

- pgTAP tests named by their test specification ID, each inside a transaction that rolls back.
- Act as the seed fixtures: `anon`, `nova`, `uma`, `pia`, `vic`, `hal`, `bea`, `sam`, `rex`, `ref`, `sta` and `adm`, with activities A1–A7 and hostels H1 and H2. `seed.sql` holds exactly the cast in test specification §1. Changing it means changing that table first, so ask.
- Every RPC function and policy has at least one passing and one refusing test (NFR-MAI-01).
- Pin time through `private.now()`. Never sleep.

## Commands

- Run the CLI through pnpm, from the repo root (`pnpm supabase …`). Since v3 it targets the local stack unless given `--remote`, which means the linked project.
- Local, any time: `start`, `stop`, `db reset`, `test db`, `migration new <name>`, `gen types --lang typescript --schema public > packages/contracts/src/database.types.ts` (Swift types join with the iOS app, T71), `functions serve`.
- Remote, staging only, and only when a task calls for it: `link`, `db push --remote`, `functions deploy`, `secrets set`. Production is never a target (a hook enforces this).
- Never wrap a remote Supabase command in a `package.json` script. The production hook sees only the command line, so a script would hide it.
