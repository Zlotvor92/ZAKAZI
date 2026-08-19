# Doteraj Me

Sistem za zakazivanje termina za solo beauty profesionalce u Srbiji.
Specifikacija proizvoda i pravila razvoja su u [`CLAUDE.md`](./CLAUDE.md).

Trenutno stanje: **Faza 2 je zaokružena**. Klijent otvori `/<slug-salona>`,
izabere uslugu, dan i sat, i termin je odmah potvrđen, bez ijedne poruke.
Vlasnica u kalendaru vidi svoj dan, sama unosi termine dogovorene uživo, menja
im status, podešava radno vreme i pravila, blokira brojeve i unosi odsustva.
Plan faze je u [`docs/faza-2.md`](./docs/faza-2.md).

Poruke i podsetnici, kapare i reputacioni skor tek dolaze.

## Šta treba imati

- Node.js 20 ili noviji
- [Supabase CLI](https://supabase.com/docs/guides/local-development) za lokalni rad
- Docker, ako želiš da baza radi lokalno (`supabase start`)

## Lokalno pokretanje

```bash
npm install
supabase start
```

`supabase start` na kraju ispiše `API URL` i `anon key`. Prepiši ih:

```bash
cp .env.example .env.local
# popuni NEXT_PUBLIC_SUPABASE_URL i NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Migracije i početni podaci:

```bash
supabase db reset
```

Ova komanda primeni sve iz `supabase/migrations/` pa pusti `supabase/seed.sql`,
koji napravi jedan salon, vlasnika, izvođača, tri usluge i radno vreme pon–sub.
Mejl vlasnika je na vrhu seed fajla; promeni ga u svoj pre prvog pokretanja.

```bash
npm run dev
```

Otvori `http://localhost:3000`. Tu je javna početna strana; prijava je na
`/prijava`. Upiši mejl vlasnika; lokalno poruka ne odlazi na internet nego
stiže u Supabase-ov sandučić na `http://127.0.0.1:54324`.

Javna stranica salona iz seed-a je `http://localhost:3000/studio-milica`. Ona
ne traži prijavu — otvori je u prozoru bez istorije da bi videla ono što vidi
klijent.

## Komande

| Komanda | Šta radi |
|---|---|
| `npm run dev` | razvojni server |
| `npm run build` | produkcijski build |
| `npm run typecheck` | TypeScript u strict režimu |
| `npm run lint` | ESLint |
| `npm test` | testovi poslovne logike, bez baze |
| `npm run test:db` | testovi ograničenja i RLS politika, traže Postgres |
| `npm run test:e2e` | kritični tok kroz pregledač, traži pokrenut Supabase |

`npm run test:db` pravi bazu `zakazi_test` na serveru iz `DATABASE_URL`
(podrazumevano lokalni Supabase na portu 54322), primeni migracije i radi nad
njom. Svaki test se vrti u transakciji koja se poništava.

`npm run test:e2e` traži ceo lokalni Supabase (`supabase start`) i `.env.local`,
jer prolazi kroz pregledač do prave baze. Pre prvog pokretanja treba
`npx playwright install chromium`. Test zakazuje termin u seed salonu i ostavlja
ga za sobom — pokreni `supabase db reset` kad hoćeš čist kalendar.

## Struktura

```
app/(auth)/prijava/       prijava magic linkom
app/(public)/             javna stranica za zakazivanje
app/(dashboard)/          kalendar, unos termina i podešavanja
app/auth/callback/        razmena koda za sesiju
components/calendar/      traka nedelje i dnevni spisak
lib/db/                   pristup podacima, po entitetu
lib/domain/               poslovna logika, čiste funkcije bez I/O
lib/i18n/sr.ts            svi tekstovi interfejsa
lib/supabase/             klijenti za server i middleware
supabase/migrations/      numerisane SQL migracije
supabase/seed.sql         početni podaci
tests/domain/             testovi poslovne logike
tests/db/                 testovi baze i RLS politika
tests/e2e/                kritični tok kroz pregledač
```

## Objavljivanje

Na Vercelu su potrebne dve promenljive okruženja:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Obe se ugrađuju u toku build-a, pa posle izmene treba napraviti novu verziju.
Ključ koji zaobilazi RLS nigde nije potreban i ne sme se dodavati.

Sesija se u middleware-u proverava lokalno, `getClaims()` umesto `getUser()`,
pa svaki zahtev ka `/dashboard` više ne ide na Supabase Auth. To traži da
projekat potpisuje tokene asimetrično (ES256, „JWT Signing Keys" u konzoli).
Ako se ikad vrati na simetričan ključ, biblioteka sama pada nazad na `getUser`
i sve i dalje radi, samo sporije.

`vercel.json` drži funkcije u Frankfurtu, jer je tamo i baza. Bez toga Vercel
ih pusti u Americi i svaki upit dva puta pređe Atlantik — na stranici koja ih
napravi tri do četiri, to je sekunda i po samo na putovanje. Ako baza ikad
promeni regiju, ovo se menja sa njom.

U Supabase projektu, pod **Authentication → URL Configuration**, adresa sajta i
dozvoljene adrese za povratak moraju pokazivati na objavljeni domen, inače
Supabase odbija da pošalje link za prijavu.

### Migracije baze

Migracije se primenjuju same. Supabase-ova GitHub integracija prati `main` i
na svaki push pusti sve iz `supabase/migrations/` čega nema u
`schema_migrations` na serveru. Stigne za tridesetak sekundi, pre nego što
Vercel završi build. U `ci.yml` za to nema nijednog posla i ne treba ga
dodavati — dva sistema koja oba primenjuju migracije samo prave zabunu oko
toga koji je stvarno odradio posao.

Posao `Baza` u CI-ju primeni sve migracije na čist Postgres i pusti testove
nad njim. To nije brava nego alarm: vrti se uporedo sa primenom na
produkciji, ne pre nje. Ako migracija ne valja, pocrveni u roku od minuta.

Polomljena migracija ne ostavlja bazu u pola posla — Postgres izvršava DDL u
transakciji, pa se sve poništi. „Migracija koja je pukla" znači „migracija
koja nije primenjena", ne „baza je u čudnom stanju".

**Migracije pišu se tako da stara verzija koda preživi novu bazu.** Ovo je
jedino pravilo koje te ovde stvarno čuva, jer brave nema. Supabase primeni
migraciju za pola minuta, Vercel objavi kod za dva — u tom razmaku nova baza
radi sa starim kodom. Dodavanje tabele, kolone ili funkcije to podnosi.
Brisanje kolone koju stari kod još čita ne podnosi: takva izmena ide u dva
koraka, kroz dva objavljivanja.

### Potvrda vlasništva domena kod Google-a

Fajl za potvrdu (`google<token>.html`) ide u **`public/`**, nikako u `app/`:
`[tenantSlug]` hvata svaku adresu koju ne prepozna, pa bi iz `app/` umesto
očekivanog sadržaja stigla strana salona. `public/` se razrešava pre rutiranja,
isto kao `sw.js` i ikone.

Spisak iz `public/` se pravi u toku build-a, pa fajl počne da se servira tek sa
sledećom verzijom — mora biti commit-ovan da bi ga Vercel uopšte video.

Potvrda preko DNS zapisa (TXT) zaobilazi sve ovo i ne traži novu verziju sajta.
