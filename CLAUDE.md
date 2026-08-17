# Majstorica — sistem za zakazivanje termina

## Šta gradimo

SaaS aplikacija za zakazivanje termina namenjena **solo beauty profesionalcima u Srbiji** — nokat-tehničarke, kozmetičarke, majstori za trepavice i obrve, brijači. Tipičan korisnik radi sam ili u dvoje, iz iznajmljene stolice ili od kuće, klijente prima preko Instagram poruka, a termine vodi u papirnoj svesci.

Cena proizvoda je 990–3.900 RSD mesečno. To znači da korisnik nema strpljenja ni za kakvu složenost i da svaki suvišan klik košta pretplatu.

**Ovo NIJE** salon ERP. Nema POS-a, nema zaliha, nema obračuna plata, nema marketing kampanja. Ako se pojavi predlog da se doda nešto od toga — odbij ga i podseti me na ovaj pasus.

## Jezik

- **Korisnički interfejs: srpski** (latinica), sav tekst vidljiv korisniku
- **Kod: engleski** — imena tabela, kolona, funkcija, promenljivih, komentari, poruke commit-a
- Tekstove interfejsa drži u jednom mestu (`lib/i18n/sr.ts`), ne razbacane po komponentama, da bi se kasnije lako dodao drugi jezik

## Stack

| Sloj | Tehnologija |
|---|---|
| Framework | Next.js 15, App Router, TypeScript strict |
| Baza | Supabase (Postgres 15+) sa Row Level Security |
| Auth | Supabase Auth |
| Stil | Tailwind CSS + shadcn/ui |
| Validacija | Zod na svakoj granici — form, API ruta, server action |
| Datumi | date-fns + date-fns-tz |
| Testovi | Vitest za logiku, Playwright za kritične tokove |
| Hosting | Vercel |

Ne uvodi nove biblioteke bez da prvo pitaš i objasniš zašto postojeće ne rešavaju problem.

## Nepregovarljiva pravila

### 1. Multi-tenant od prvog dana

Svaka tabela sa podacima korisnika nosi `tenant_id uuid not null`. Svaka tabela ima RLS politiku. Izolacija se **nikada** ne oslanja na `where tenant_id = ...` u aplikacionom kodu — to je samo optimizacija, RLS je odbrana.

### 2. Vreme

- Sve se čuva u **UTC** kao `timestamptz`
- Prikazuje se u tajmzoni tenanta, podrazumevano `Europe/Belgrade`
- Nikada ne koristi `new Date()` za poslovnu logiku bez eksplicitne tajmzone
- Srbija menja letnje/zimsko računanje vremena — termin zakazan u martu za oktobar mora pasti na tačan sat

### 3. Dupla rezervacija se sprečava u bazi

Obavezno, u prvoj migraciji koja uvodi `appointments`:

```sql
create extension if not exists btree_gist;

alter table appointments
  add constraint appointments_no_overlap
  exclude using gist (
    staff_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (status in ('pending', 'confirmed'));
```

Provera slobodnog termina u JavaScript-u pre `insert`-a **nije** zaštita. Ona služi samo da korisnik dobije lepšu poruku umesto greške iz baze. Obe moraju postojati.

### 4. Audit log

Svaka promena statusa termina upisuje red u `appointment_events`: šta se promenilo, ko je promenio, kada, sa kog uređaja. Bez izuzetka. Kad korisnica kaže „ja to nisam otkazala", moramo imati dokaz.

### 5. Svaka poslata poruka se loguje

Tabela `messages`: kanal, šablon, primalac, status isporuke, **procenjena cena**. Marža po nalogu se ne može izračunati bez ovoga.

### 6. Bez sirovih SQL upita u komponentama

Pristup podacima ide isključivo kroz funkcije u `lib/db/`. Komponente ne znaju za Supabase klijent.

## Struktura foldera

```
app/
  (public)/[tenantSlug]/          javna stranica za zakazivanje
  (dashboard)/                    interfejs za salon
  api/
    webhooks/whatsapp/
    cron/                         Vercel cron jobs
lib/
  db/                             pristup podacima, po entitetu
  domain/                         poslovna logika, čista, bez I/O
    availability.ts               generisanje slobodnih termina
    risk.ts                       reputacioni skor
  messaging/                      WhatsApp, Viber, email
  i18n/sr.ts                      svi tekstovi interfejsa
supabase/migrations/              numerisane SQL migracije
tests/
```

Poslovna logika u `lib/domain/` mora biti čiste funkcije bez pristupa bazi i mreži, da bi bila testirana bez ikakvog mock-ovanja.

## Model podataka

```
tenants              id, slug, name, timezone, plan, created_at
users                Supabase auth users
memberships          user_id, tenant_id, role: owner | staff
staff                tenant_id, user_id (nullable), name, active
services             tenant_id, name, duration_min, buffer_after_min,
                     price_rsd, requires_deposit, active
staff_services       staff_id, service_id
working_hours        staff_id, weekday, start_time, end_time
time_off             staff_id, start_at, end_at, reason
clients              tenant_id, name, phone_e164, notes, created_at
client_identities    phone_hash (globalno), first_seen_at, risk_state
appointments         tenant_id, staff_id, service_id, client_id,
                     start_at, end_at, status, price_rsd, source,
                     risk_score, confirmed_at
appointment_events   appointment_id, from_status, to_status,
                     actor_type, actor_id, device_id, created_at
waitlist             tenant_id, service_id, client_id, desired_range
messages             tenant_id, appointment_id, channel, template,
                     to_phone, status, cost_estimate, sent_at
risk_events          phone_hash, tenant_id, kind, weight, created_at
blocklist            tenant_id, phone_e164, reason, created_by, created_at
deposits             appointment_id, amount_rsd, ips_reference,
                     status, paid_at
subscriptions        tenant_id, plan, period_start, period_end, status
```

### Statusi termina

`pending` → `confirmed` → `completed` | `no_show`
`pending` | `confirmed` → `cancelled_by_client` | `cancelled_by_salon`

`pending` znači da termin čeka odobrenje ili verifikaciju. Drži slot najviše 30 minuta, pa ističe.

## Zaštita od zloupotrebe

Puna specifikacija dolazi u Fazi 4. Dva principa važe od početka:

1. **Nevidljivo za 90% ljudi.** Svaki dodatni korak u formi obara konverziju. Trenje raste samo sa rizikom.
2. **Nikada CAPTCHA kao prva mera.** Velik deo korisnika su žene 40+ koje odustanu na CAPTCHA. Uvodi se tek iznad praga rizika.

Kad se implementira, između tenanta se deli **isključivo izvedeni signal rizika** — nikad sirov identitet, ime, niti kod kog salona se nešto desilo. Telefon se čuva heširan u `client_identities`.

## Definicija „gotovo"

Zadatak nije gotov dok:

- TypeScript prolazi u strict režimu bez `any`
- Postoji test za poslovnu logiku koju uvodi
- RLS politika postoji za svaku novu tabelu i testirana je iz perspektive drugog tenanta
- Radi na telefonu — **90% korisnika koristi ovo isključivo na telefonu**
- Nema `console.log` ostataka

## Kako želim da radiš

- **Pitaj pre nego što pretpostaviš.** Ako specifikacija ne pokriva slučaj, pitaj me, nemoj izmišljati.
- **Male, kompletne izmene.** Jedna funkcionalnost po commit-u. Ne prepravljaj tri fajla koja nisam tražio.
- **Ne piši kod za budućnost.** Bez apstrakcija „za slučaj da nam zatreba".
- **Reci mi kad grešim.** Ako tražim nešto što će se raspasti na 50 korisnika, reci to direktno pre nego što to napraviš.
- **Bez suvišnog komentarisanja.** Komentar objašnjava *zašto*, nikad *šta*.
