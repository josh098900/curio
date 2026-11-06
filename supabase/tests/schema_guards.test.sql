-- Schema guards: the fitness functions that read the system catalogue (test specification
-- §3.1, spec §14.2). They cover the schemas Curio's migrations own, public and private.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- DB-SCH-02's allow-list. Add each function in the change that creates it: the public RPC
-- functions, and the private functions that RLS policies, views and caller-rights SQL functions
-- call. Those run as the caller, so authenticated needs the right to run them, but it still
-- can't call them, because it can't use the private schema (DB-SCH-04). Anon runs only
-- public.health(), which reads nothing and returns true for the health check (spec §9, §14.3).
create temporary table allow_list (signature text primary key);

select is_empty(
  $$
    select n.nspname || '.' || c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  $$,
  'DB-SCH-01 every table in public has RLS enabled'
);

-- A view runs with its owner's rights, which skip RLS, unless it's security_invoker.
-- Materialized views and foreign tables can't have RLS at all.
select is_empty(
  $$
    select n.nspname || '.' || c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and (
        c.relkind in ('m', 'f')
        or (c.relkind = 'v' and not exists (
          select 1
          from unnest(c.reloptions) as option
          where option ~* '^security_invoker=(true|on|yes|1)$'
        ))
      )
  $$,
  'DB-SCH-01 every view in public runs as the caller, and there''s no materialized view or foreign table'
);

select set_eq(
  $$
    select n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
  $$,
  $$ values ('public.health()') $$,
  'DB-SCH-02 anon can run only public.health()'
);

select set_eq(
  $$
    select n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and has_function_privilege('authenticated', p.oid, 'execute')
  $$,
  'select signature from allow_list',
  'DB-SCH-02 authenticated can run exactly the allow-list'
);

select is_empty(
  $$
    select signature
    from allow_list
    where signature like 'private.%'
      and split_part(signature, '(', 1) not in (
        'private.is_participant', 'private.is_admin', 'private.is_blocked',
        'private.now', 'private.raise_error'
      )
  $$,
  'DB-SCH-02 in private, the allow-list holds only the policy helpers, now() and raise_error()'
);

select is_empty(
  $$
    select n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and not coalesce('search_path=""' = any (p.proconfig), false)
  $$,
  'DB-SCH-03 every security definer function has an empty search_path'
);

-- PostgREST reads the exposed schemas from its own settings, outside the database, so this
-- checks what keeps private out of the Data API even if a setting exposed it: the API's
-- roles can't use the schema.
select has_schema('private', 'DB-SCH-04 the private schema exists');

select is_empty(
  $$
    select r.rolname::text
    from pg_roles r
    cross join pg_namespace n
    where r.rolname in ('anon', 'authenticated') and n.nspname = 'private'
      and has_schema_privilege(r.rolname, n.oid, 'usage')
  $$,
  'DB-SCH-04 anon and authenticated can''t use the private schema'
);

-- An index serves a foreign key when its leading columns are the key's columns. A partial
-- index doesn't count, because it misses the rows outside its condition.
select is_empty(
  $$
    select n.nspname || '.' || c.relname || ' (' || array_to_string(array(
      select a.attname
      from unnest(con.conkey) with ordinality as k (attnum, ord)
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
      order by k.ord
    ), ', ') || ')'
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where con.contype = 'f' and n.nspname in ('public', 'private')
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = con.conrelid and i.indpred is null
          and (i.indkey::int2[])[0:cardinality(con.conkey) - 1] @> con.conkey
      )
  $$,
  'DB-SCH-07 every foreign key has an index that starts with its columns'
);

-- An extension's objects take its schema's grants, and some extensions grant to everyone
-- themselves, so none may sit beside Curio's own objects.
select is_empty(
  $$
    select e.extname::text
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where n.nspname in ('public', 'private')
  $$,
  'DB-SCH-09 no extension is installed in public or private'
);

select * from finish();
rollback;
