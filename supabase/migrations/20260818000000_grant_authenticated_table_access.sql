-- Dashboard čita i piše tabele direktno (kao pozivalac, ne security definer),
-- pa mu RLS bira redove — ali `BYPASSRLS` kod `service_role` i sama RLS
-- politika kod `authenticated` ne znače ništa dok Postgres ACL prvo ne
-- dozvoli sam pristup tabeli. Migracija 20260816370000 je to izrekla za
-- `anon` ("Supabase podrazumevano daje anon roli sva prava nad svakom novom
-- tabelom, a odbrana leži isključivo na RLS-u") pretpostavljajući da to
-- Supabase sam uradi za `authenticated` i `service_role`. Na sveže
-- postavljenoj bazi (`supabase db reset`) to se ne dešava — ni jedna od te
-- dve role nema `SELECT`/`INSERT`/`UPDATE`/`DELETE`, samo `TRUNCATE`,
-- `REFERENCES`, `TRIGGER`, `MAINTAIN`. Dashboard zato pada sa "permission
-- denied for table tenants".

grant select, insert, update, delete
  on all tables in schema public
  to authenticated, service_role;

-- Isto za tabele koje tek nastanu, iz istog razloga kao kod `anon` migracije:
-- inače se rupa vraća sama od sebe prvom sledećom migracijom koja doda
-- tabelu.
alter default privileges in schema public
  grant select, insert, update, delete on tables
  to authenticated, service_role;

-- Blanket dodela iznad ponovo otvara `tenants.slug`/`name`/`plan` za
-- `authenticated` — privilegije se u Postgresu sabiraju, pa širi grant nadjača
-- uži bez obzira na redosled migracija. Migracija 20260816260000 je namerno
-- suzila `authenticated` na tri kolone ("vlasnica sme da menja pravila
-- zakazivanja, ali ne i slug, ime ili plan"); ista namera se ovde ponavlja.
revoke update on tenants from authenticated;
grant update (booking_horizon_days, min_lead_minutes, public_booking_enabled)
  on tenants to authenticated;
