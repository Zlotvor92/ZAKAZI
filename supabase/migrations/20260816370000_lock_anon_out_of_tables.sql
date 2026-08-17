-- Neulogovan posetilac ne dobija ništa osim dve funkcije.
--
-- Supabase podrazumevano daje `anon` roli sva prava nad svakom novom tabelom,
-- a odbrana leži isključivo na RLS-u: politike su sve `to authenticated`, pa
-- anon ne pogađa nijednu i vidi nula redova. To radi, i testirano je.
--
-- Ali sad je sajt javan, a jedna zaboravljena tabela bez RLS-a ili jedna
-- politika napisana `to public` bila bi otvorena vrata — jer bi privilegija
-- već bila tu i čekala. Javnoj strani ove privilegije ionako ne trebaju:
-- `public_booking_data` i `public_book` su `security definer` i tabelama
-- pristupaju kao vlasnik, ne kao pozivalac.

revoke all on all tables in schema public from anon;

-- Isto važi i za tabele koje tek nastanu, inače se rupa vraća sama od sebe
-- prvom sledećom migracijom.
alter default privileges in schema public revoke all on tables from anon;

-- Vraća samo tačno/netačno o pozivaocu, a za anon je uvek netačno. Nema
-- razloga da postoji na spisku onoga što neprijavljeni sme da pozove.
--
-- Mora i `public`: Postgres pravo izvršavanja nad funkcijom podrazumevano daje
-- roli `public`, pa oduzimanje samo `anon`-u ne menja ništa.
revoke execute on function is_tenant_member(uuid) from public, anon;
grant execute on function is_tenant_member(uuid) to authenticated;
