-- Minimalni deo Supabase okruženja od kojeg migracije zavise. Testovi prave
-- svoju bazu od nule, pa ovde stoji samo ono na šta migracije i politike
-- stvarno pokazuju: tabela korisnika, tri role i `auth.uid()`.
--
-- `auth.uid()` je prepisan onako kako ga Supabase definiše — čita `sub` iz
-- JWT tvrdnji koje PostgREST postavi na početku svakog zahteva. Testovi te
-- tvrdnje postavljaju ručno i tako se predstavljaju kao konkretan korisnik.

create schema if not exists auth;

-- Kolone koje seed stvarno popunjava, sa istim tipovima kao kod Supabase-a.
-- Nema smisla imitirati celu tabelu, ali ono što upisujemo mora da postoji da
-- bi seed mogao da se testira.
create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud text,
  role text,
  email text unique,
  email_confirmed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  confirmation_token text,
  recovery_token text,
  email_change_token_new text,
  email_change text
);

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

create or replace function auth.uid() returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase isto ovako unapred daje prava nad tabelama koje tek nastaju;
-- odbrana je RLS, ne odsustvo GRANT-a.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
