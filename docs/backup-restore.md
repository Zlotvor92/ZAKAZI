# Kopija baze i vraćanje

Stanje na 8. oktobar 2026. Ovde piše šta kopija stvarno jeste i šta je do sada
**proveravano**, a šta je tek plan. Plan nije prikazan kao urađen.

## Šta se kopira

- Posao `Backup` (`.github/workflows/backup.yml`) jednom dnevno u 01:20 UTC pravi
  `pg_dump` šema `public` i `auth` iz Supabase projekta.
- Dump se šifruje `age` javnim ključem. Privatni ključ nije na GitHub-u, pa se bez
  njega kopija ne može otvoriti — ni u slučaju provale u GitHub nalog.
- Odredišta: privatni repo `Zlotvor92/zakazi-backup` (fajl po danu u `dnevno/`) i,
  kad se podese tajne, Cloudflare R2.
- Stanje poslednjeg prolaza vidi se na banneru u administraciji
  (`lib/domain/backup-health.ts`): kopija starija od 26 sati je `stale`.

## Šta se NE kopira

- **Slike (logo salona).** SQL dump nosi samo adresu slike. Same datoteke su u
  Supabase Storage bucket-u `logos` i nemaju nikakvu kopiju. Posle gubitka
  projekta salon bi imao adresu koja vodi u prazno. Nije rešeno.
- **Podešavanja Supabase-a**: Auth provajderi (Google), SMTP, redirect adrese,
  tajne u Vercel-u (`SUPABASE_SERVICE_ROLE_KEY`, VAPID ključevi, `CRON_SECRET`).
  Lista tajni je u `.env.example`; njihove vrednosti moraju da se čuvaju odvojeno.
- **Proširenja baze.** `pg_dump --schema` ih preskače. Bez `btree_gist` se
  ograničenje `appointments_no_overlap` pri vraćanju **tiho odbije** i baza
  izgleda ispravno, ali ne sprečava dvostruko zakazivanje. Pre svakog vraćanja:
  `create extension if not exists btree_gist;` i
  `create extension if not exists pgcrypto with schema extensions;`.

## Ciljevi

| | Vrednost | Napomena |
|---|---|---|
| Najveći gubitak podataka (RPO) | do 24 sata | Poslednja noćna kopija. Ovo je posledica rasporeda, ne dogovoren cilj — odluka vlasnika platforme da li je dovoljno. |
| Vreme oporavka (RTO) | **nije izmereno** | Puno vraćanje nikad nije izvedeno. Ne navodim broj koji ne znam. |
| Odgovorna osoba | vlasnik platforme (GitHub nalog `Zlotvor92`) | Jedini ima privatni `age` ključ. |
| Gde je postupak | ovaj fajl | |

Rizik koji ovo sa sobom nosi: privatni ključ ima jedna osoba. Ako se izgubi, sve
kopije su nečitljive. Čuvati ga na najmanje dva odvojena mesta.

## Šta noćna proba vraćanja proverava

Proba (`.github/scripts/verify-restore.sh`) diže prazan Postgres 17, dodaje
proširenja i role, uveze dump i proverava:

1. Svaka tabela iz šeme `public` postoji i ima **tačno** onoliko redova koliko
   fajl nosi. *Pad probe.*
2. Ograničenje `appointments_no_overlap` postoji. *Pad probe.*
3. Broj RLS-a, politika, ograničenja, okidača, funkcija i indeksa isti kao u
   fajlu. *Upozorenje*, ne pad: običan Postgres ume da odbije objekat koji zavisi
   od Supabase-a. Kad se vidi stvaran izlaz noćnog posla (log koraka „Proba
   vraćanja"), ovo treba pooštriti na pad.

Proba ide **posle** slanja kopija. Pad probe pocrveni posao, ali kopija je tada
već sačuvana.

Lokalno provereno nad dump-om baze sa svim migracijama: probu pada kad fali
`btree_gist` i kad fali red; prolazi kad je vraćanje potpuno. **Nije proveren
stvarni produkcioni dump** — prvi noćni prolaz posle ove izmene je prvi pravi test,
i njegov izlaz treba pogledati.

## Puno vraćanje — plan, nije izvedeno

Noćna proba ne proverava Supabase kao platformu (GoTrue, PostgREST, Storage), ni
da se u vraćenoj bazi može prijaviti. To traži vraćanje u okruženje kompatibilno sa
Supabase-om. Predlog, jednom u tri meseca i posle svake veće promene šeme:

1. Preuzeti najnoviji fajl iz `zakazi-backup/dnevno/` i dešifrovati ga privatnim
   ključem: `age -d -i kljuc.txt zakazi-YYYY-MM-DD.sql.gz.age | gunzip > dump.sql`.
2. Dići izolovano Supabase okruženje (lokalni `supabase start`, ili poseban probni
   projekat — ne produkcija).
3. Dodati proširenja iz odeljka iznad, pa uvesti `public` deo. Šema `auth` u
   Supabase projektu već postoji i njom upravlja GoTrue, pa se `auth.users` uvozi
   samo kao podaci. *Tačan postupak treba ispisati pri prvom izvođenju.*
4. Proveriti: prijava vlasnika, javno zakazivanje, dupla rezervacija odbijena,
   korisnik jednog salona ne vidi drugi (RLS), uključivanje obaveštenja,
   `public_cancel_appointment`, logo (vidi „Šta se NE kopira").
5. Upisati ovde datum, trajanje (to je prvo stvarno merenje RTO-a) i šta je puklo.

| Datum | Trajanje | Rezultat |
|---|---|---|
| — | — | Nije izvedeno. |
