-- Spisak objekata šeme public, jedan red po objektu. Pušta se nad produkcijom
-- (samo čitanje kataloga) i nad stekom izgrađenim iz migracija; razlika znači
-- da migracije ne daju istu bazu kao produkcija. Bez podataka iz tabela.
--
-- Isti `search_path` na obe strane, da se `auth.users` ne ispisuje jednom kao
-- `auth.users`, a jednom kao `users`. Krajevi redova (`\r`) se ignorišu:
-- produkcija ima funkcije iz prvih migracija sa Windows prelomima, što menja
-- tekst, a ne ponašanje.
set search_path = pg_catalog, public;

select line from (
  select 'tabela ' || c.relname || ' rls=' || c.relrowsecurity as line
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
  union all
  select 'kolona ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
         || case when a.attnotnull then ' not null' else '' end
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
  union all
  select 'ograničenje ' || conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
  from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select 'politika ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || roles::text || ' '
         || coalesce(qual, '') || ' ' || coalesce(with_check, '')
  from pg_policies where schemaname = 'public'
  union all
  select 'funkcija ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
         || md5(replace(pg_get_functiondef(p.oid), E'\r', ''))
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype in ('e', 'i'))
  union all
  select 'pravo-funkcija ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
         || coalesce((select string_agg(x::text, ',' order by x::text) from unnest(p.proacl) x), 'podrazumevano')
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype in ('e', 'i'))
  union all
  select 'pravo-tabela ' || c.relname || ' '
         || coalesce((select string_agg(x::text, ',' order by x::text) from unnest(c.relacl) x), 'podrazumevano')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
  union all
  select 'indeks ' || indexdef from pg_indexes where schemaname = 'public'
  union all
  select 'okidač ' || tgrelid::regclass || ' ' || tgname || ' ' || md5(replace(pg_get_triggerdef(t.oid), E'\r', ''))
  from pg_trigger t
  where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
  union all
  select 'tip ' || t.typname || ' ' || coalesce((select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum e where e.enumtypid = t.oid), '')
  from pg_type t
  where t.typnamespace = 'public'::regnamespace and t.typtype = 'e'
) x
order by line;
