-- Minimalni deo Supabase šeme od kojeg migracije zavise. Testovi prave svoju
-- bazu od nule, pa `auth.users` ne postoji dok ga ovde ne napravimo. Ovde
-- stoji samo ono na šta migracije stvarno pokazuju — ne imitiramo Supabase
-- Auth, samo tabelu na koju vise strani ključevi.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text
);
