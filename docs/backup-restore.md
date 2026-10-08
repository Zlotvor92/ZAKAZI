# Kopija baze i vraćanje

Stanje na 8. oktobar 2026. Ovde piše šta kopija stvarno jeste i šta je do sada
**proveravano** (sa izmerenim rezultatom), a šta nije.

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
  projekta salon bi imao adresu koja vodi u prazno. Kopija se ne pravi (danas je to
  jedan logo). Postupak posle gubitka: napravi javni bucket `logos` (migracije ga ne
  definišu; ime je `LOGO_BUCKET` u `lib/db/logo.ts`), pa svaki salon ponovo otpremi
  logo u podešavanjima. Zato **originalne logoe čuvaj i van Supabase-a**.
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
| Vreme oporavka (RTO) | automatizovani deo: **~2 min** | Od praznog runnera do potvrđene provere (stek, podaci, prijava, RLS). **Ručni deo nije meren**: novi Supabase projekat, Auth podešavanja, tajne u Vercel-u, redeploy, domen, dešifrovanje. Ne navodim broj koji ne znam. |
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

Izmereno nad **pravim produkcionim dump-om** (8. oktobar 2026, ručno pokretanje
`Backup` sa `samo_proba=true`, bez slanja ičega): svih 17 tabela se poklapa red po
red, RLS (17), politike (38), ograničenja (91), okidači (7), funkcije (55) i
indeksi (24) se poklapaju, `appointments_no_overlap` je vraćen, a vraćanje je
trajalo 5 s. Jedina greška pri uvozu je očekivana (`schema "public" already
exists`). Šifrovanje i dešifrovanje privremenim ključem vraćaju isti dump.

Stvarni privatni `age` ključ je **8. oktobra 2026.** otvorio stvarnu kopiju iz
`zakazi-backup` (workflow `Verify backup`, run 37794711792): ključ odgovara javnom
ključu koji koristi noćni posao, dešifrovanje je uspelo (352.463 B) i kopija
sadrži očekivane tabele. To je jednokratan dokaz. Ponoviti posle rotacije ključa
ili jednom kvartalno: privremeno postavi tajnu `AGE_PRIVATE_KEY_TEST`, pokreni
`Verify backup` ručno, pa tajnu odmah obriši. Privatni ključ ne ide u repo ni u chat.

## Puno vraćanje u Supabase stek (izvedeno)

`.github/workflows/restore-drill.yml` (ručno, i jednom mesečno) radi ono što bi se
radilo u nesreći, nad svežom kopijom produkcije i u kontejnerima koji nestaju sa
runnerom. Produkcija se samo čita (jedan `pg_dump` i upiti nad katalogom).

Postupak, tačno kako je izveden:

1. Pun dump šema `public` i `auth`, istim zastavicama kao noćna kopija.
2. Vraćanje u običan Postgres (sa `btree_gist`, `pgcrypto` i rolama), pa izvlačenje
   **samo podataka**: `pg_dump --data-only -t 'public.*' -t auth.users -t auth.identities`.
3. Novi Supabase stek (`supabase start`) izgrađen iz migracija u repou. Migracije
   nose šemu **i prava**; dump ih ne nosi (`--no-privileges`), pa se bez migracija
   posle vraćanja ništa ne bi moglo pročitati preko API-ja.
4. Učitavanje podataka kao `supabase_admin` sa `session_replication_role = replica`
   u jednoj transakciji (`ON_ERROR_STOP=1`): bez toga okidač nad `appointments`
   iznova pravi događaje koji su već u dump-u.
5. Provere, sve preko pravog PostgREST-a i GoTrue-a.

Izmereno 8. oktobra 2026 (tri uzastopna prolaza, isti rezultat):

| Provera | Rezultat |
|---|---|
| Redovi: 17 tabela `public` + `auth.users` (5) + `auth.identities` (7) | poklapaju se sa dump-om |
| `anon` čita `appointments` / zove `public_book` | HTTP 401 oba |
| `public_booking_data` preko PostgREST-a | vraća salon sa uslugama |
| Prijava vlasnika preko GoTrue-a nad vraćenim `auth.users` | uspela |
| RLS sa pravim tokenom | vlasnik vidi tačno svoj salon i tačno svih svojih 102 termina |
| Izolacija između salona | proverena sa privremenim drugim salonom (produkcija ima jedan) u oba smera |
| Dvostruko zakazivanje | baza odbija preklapanje |
| Šema iz migracija naspram produkcije | **470 od 470 objekata identično**, uključujući prava (ACL) |
| 5 migracija koje produkcija još nema, na kopiji stvarnih podataka | primenjene za 1 s; broj redova isti; sva tri telefonska ograničenja se potvrđuju |
| Trajanje | 1 min 55 s ukupno od praznog runnera, od čega je većina podizanje steka; učitavanje podataka manje od 1 s |

Šta je usput nađeno:
- Noćni posao nikad nije imao `checkout`, pa skripta za proveru ne bi postojala.
- Prve migracije (`init`, `rls`) su u produkciji primenjene sa Windows prelomima
  redova (`\r\n`) u telu funkcija. Ponašanje je isto; poređenje šeme to ignoriše.
- Produkcija ima **jedan** salon i pet korisnika. Izolacija RLS-a se zato ne može
  dokazati nad pravim podacima samo; drill pravi drugi salon u steku.

Šta ovo i dalje **ne** pokriva:
- Pravi Supabase projekat (hosted): ovde je lokalni stek. Na hostovanom projektu
  `postgres` rola ne mora da sme `session_replication_role`; to treba potvrditi
  prvi put kad se to stvarno radi.
- Podešavanja Supabase-a, tajne, domen, Vercel, Storage (logo datoteke); za to
  postoji kontrolna lista ispod, ali nikad nije izvedena na pravom projektu.
- Obaveštenja na uređaju: pretplate se vraćaju, ali ih uređaji moraju ponovo
  potvrditi ako se promeni VAPID par.

Ako se `restore-drill` ikad zacrveni, to je ono što bi se desilo u nesreći.

## Kontrolna lista: povratak u novi hostovani Supabase projekat

Nije izvedena na pravom projektu i vreme nije izmereno. Prvi put kad se radi,
upiši koliko je trajalo svako od koraka.

1. Napravi novi Supabase projekat u istom regionu. Zabeleži URL, `anon` i `service_role` ključ.
2. Uključi proširenje `btree_gist` (bez njega se `appointments_no_overlap` pri vraćanju tiho odbije).
3. Primeni migracije iz repoa: `supabase db push`. One nose i prava; dump ih ne nosi (`--no-privileges`).
4. Dešifruj najnoviju kopiju privatnim `age` ključem i vrati **samo podatke** (postupak iz `restore-drill.yml`). Na hostovanom projektu `postgres` rola ne mora da sme `session_replication_role`; ako ne sme, vraćaj redom po tabelama.
5. Auth: Google provajder, redirect adrese, SMTP (`docs/resend-smtp.md`), šabloni mejlova.
6. Storage: napravi javni bucket `logos`, pa ponovo otpremi logoe.
7. Vercel promenljive (`.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_GOOGLE_SIGN_IN`. Ako se VAPID par promeni, svaki uređaj mora ponovo da uključi obaveštenja.
8. GitHub tajne za noćni posao: `SUPABASE_DB_PASSWORD` (novi projekat), `BACKUP_REPO_TOKEN`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Javni `age` ključ je u `backup.yml`.
9. Ponovo pokreni deploy na Vercel-u, pa ručno pokreni `Backup` i `Verify backup`.
10. Provera: prijava vlasnice, javna strana salona, probno zakazivanje i otkazivanje (na kraju obriši test termin).

Gde je vrednost svake tajne sačuvana (menadžer lozinki, Vercel, GitHub) treba da
stoji uz svaki red kad se lista prvi put prođe; ovde namerno nema vrednosti.

## Šta javlja kad nešto prestane da radi

- **Noćna kopija:** crvena oznaka u konzoli platforme (`/admin`) ako je poslednji prolaz pao
  ili je stariji od 26 sati. Vidi se samo kad neko otvori konzolu. GitHub šalje mejl
  za pao zakazan posao, ali samo ako je to uključeno u podešavanjima obaveštenja
  naloga — proveri jednom.
- **Cron `obavljeni-termini`:** nema signala. Posledica ćutanja je mala (termini iz
  prošlosti ostaju „potvrđeni" dok se ne označe), a tragove ostavlja Vercel → Cron Jobs.
- **Obaveštenja:** razlog neuspele isporuke (HTTP kod servisa pregledača) upisuje se u
  `error_events`, a u `messages` ostaje „failed".
