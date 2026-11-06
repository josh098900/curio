-- Throwaway, never merged: one violation for each schema guard, to show each fails the build
-- (T03's done-when). The generated types aren't regenerated, so the contract sync fails too.

-- DB-SCH-01: a table without RLS, and a view that skips RLS.
create table public.failure_test_no_rls (id int primary key);
create view public.failure_test_view as select id from public.failure_test_no_rls;

-- DB-SCH-02: a function anon can run.
create function public.failure_test_open() returns int language sql as $$ select 1 $$;
grant execute on function public.failure_test_open() to anon;

-- DB-SCH-03: a security definer function without an empty search_path.
create function private.failure_test_definer() returns int
  language sql security definer set search_path = public as $$ select 1 $$;

-- DB-SCH-04: authenticated can use the private schema.
grant usage on schema private to authenticated;

-- DB-SCH-07: a foreign key without an index.
create table private.failure_test_parent (id int primary key);
create table private.failure_test_child (
  id int primary key,
  parent_id int references private.failure_test_parent
);

-- DB-SCH-09: an extension in public.
create extension tsm_system_rows schema public;
