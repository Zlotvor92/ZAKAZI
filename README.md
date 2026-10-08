# Doteraj Me

Sistem za zakazivanje termina za solo beauty profesionalce u Srbiji.
Specifikacija proizvoda i pravila razvoja su u [`CLAUDE.md`](./CLAUDE.md).

Trenutno stanje: **Faza 2 je zaokružena**. Klijent otvori `/<slug-salona>`,
izabere uslugu, dan i sat, i termin je odmah potvrđen, bez ijedne poruke.
Vlasnica u kalendaru vidi svoj dan, sama unosi termine dogovorene uživo, menja
im status, podešava radno vreme i pravila, blokira brojeve i unosi odsustva.
Plan faze je u [`docs/faza-2.md`](./docs/faza-2.md).

Uz to postoje: obaveštenja na telefon vlasnice (Web Push), kalendar koji se
pretplaćuje preko `.ics` adrese, više salona po jednom nalogu, konzola
vlasnika platforme, blog i stranice po zanimanju.

Poruke i podsetnici klijentkinjama, kapare i reputacioni skor tek dolaze.

### Klijentkinja pronalazi i otkazuje svoj termin

Na stranici salona stoji „**Pronađi svoj termin**" odmah ispod zaglavlja. Klijentkinja
upiše broj telefona sa kog je zakazala, vidi svoje buduće termine u tom salonu i
svaki može da otkaže (dva dodira, drugi je potvrda). Adresa je `/<slug>/otkazi`.
Preko sajta se otkazuje najkasnije **24 sata pre termina**; posle toga stranica sama
ispisuje poruku i javlja se salonu, a salon otkazuje iz kalendara. Provera ide po satu
servera, ne uređaja.

**Sam broj telefona ne otvara ništa.** Uz broj treba i dokaz da je termin zakazan
sa ovog pregledača (nema naloga, tokena za kucanje ni SMS-a):

- pri zakazivanju pregledač smisli tajnu od 256 bita; server je stavlja u `httpOnly`
  kolačić vezan za putanju salona, a baza čuva samo njen SHA-256
  (`appointments.manage_proof_hash`);
- potvrda nudi „Sačuvaj link za otkazivanje" (`/<slug>/otkazi#k=<tajna>`): otvara
  termin i sa drugog telefona ili iz drugog pregledača (Instagram → Safari). Tajna
  stoji iza `#`, pa ne ide serveru ni u log; i tamo se i dalje upisuje broj;
- termini zakazani pre ove izmene nemaju tajnu; njih otvara uređaj sa kog su
  zakazani (`appointment_events.device_id`), i ta grana nestaje sama kad prođe
  horizont zakazivanja;
- pogrešan broj, nema dokaza, tuđ salon i nepostojeći termin daju isti odgovor;
- termin koji je upisala vlasnica salona nema dokaz, pa se preko sajta ne otkazuje
  (klijentkinja se javi salonu);
- najviše **3 otkazivanja preko sajta na dan po broju i salonu**, bez obzira na mrežu;
- svaka promena statusa se upisuje u `appointment_events` (ko, kada, sa kog uređaja),
  a salon odmah dobija obaveštenje, ako ima uključena obaveštenja na telefonu.

Ko je promenio telefon, obrisao podatke pregledača ili otvara stranicu u drugoj
aplikaciji nego što je zakazivala (a nije sačuvala link), ne može sama da otkaže: javlja
se salonu, koji otkazuje iz kalendara. Detalji i odluke: [`docs/otkazivanje-zastita.md`](./docs/otkazivanje-zastita.md).

## Šta treba imati

- Node.js 22 (isti kao u CI-ju)
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
| `npm run test:e2e` | tok kroz pregledač (telefon), traži pokrenut Supabase; u CI-ju nad `next build` + `next start` |

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
app/(public)/             javna stranica za zakazivanje i „Pronađi svoj termin"
app/(dashboard)/          kalendar, unos termina, podešavanja, konzola platforme
app/api/                  cron, kalendar (.ics), prijava grešaka, CSP izveštaji
app/auth/callback/        razmena koda za sesiju
components/               kalendar, prekidač obaveštenja, status veze
lib/db/                   pristup podacima, po entitetu
lib/domain/               poslovna logika, čiste funkcije bez I/O
lib/i18n/sr.ts            svi tekstovi interfejsa
lib/messaging/            slanje obaveštenja (Web Push)
lib/supabase/             klijenti za server i middleware
public/sw.js              servisni radnik: obaveštenja i strana „nema veze"
supabase/migrations/      numerisane SQL migracije
supabase/seed.sql         početni podaci
tests/domain/             testovi poslovne logike
tests/actions/            testovi server akcija i ruta (sa mock-ovanom bazom)
tests/pwa/                testovi servisnog radnika
tests/db/                 testovi baze i RLS politika
tests/e2e/                tok kroz pregledač (Android; iPhone/WebKit informativno)
.github/scripts/          provera vraćanja kopije baze
```

## Dokumentacija

| Fajl | O čemu |
|---|---|
| [`docs/qa-matrica.md`](./docs/qa-matrica.md) | šta koji test dokazuje, šta je ručno, provera na telefonu |
| [`docs/backup-restore.md`](./docs/backup-restore.md) | šta kopija pokriva, a šta ne; ciljevi; plan punog vraćanja |
| [`docs/security-advisories.md`](./docs/security-advisories.md) | preostale ranjivosti u zavisnostima i zašto |
| [`docs/security-fixes-2026-09.md`](./docs/security-fixes-2026-09.md) | popravke iz revizije od 29. septembra |
| [`DOTERAJME_FULL_AUDIT.md`](./DOTERAJME_FULL_AUDIT.md) | **istorija**: revizija od 29. septembra, nije stanje danas |

## Objavljivanje

Na Vercelu su potrebne dve promenljive okruženja:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Obe se ugrađuju u toku build-a, pa posle izmene treba napraviti novu verziju.

Još pet promenljivih je potrebno za rad javnog dela i obaveštenja:

```
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
```

`SUPABASE_SERVICE_ROLE_KEY` zaobilazi RLS i zato ide **samo** na server, nikad
u promenljivu sa `NEXT_PUBLIC_` prefiksom. **Obavezan je:** javno zakazivanje,
otkazivanje i pretragu termina zove isključivo server (`anon` ni `authenticated`
nemaju pravo nad tim funkcijama, da hash mreže ne bi birao pozivalac), a
obaveštenja idu na uređaje koje neprijavljena klijentkinja po RLS-u ne sme da
vidi. Nalog vlasnice se pravi kroz Supabase Auth, kome anonimni ključ ne daje
pravo. Vidi `.env.example`.

Za noćni posao koji termine iz prošlog dana obeležava kao obavljene potrebna
je još `CRON_SECRET` — bilo koji dug nasumičan tekst (`openssl rand -hex 32`).
Vercel ga sam šalje ruti `/api/cron/obavljeni-termini`, koju zove svake noći u
01:00 UTC (02:00 ili 03:00 u Beogradu, zavisno od letnjeg računanja vremena).
Bez te promenljive posao se ne izvršava, a termini ostaju „potvrđeni" dok ih
vlasnica ne obeleži sama.

**Šta „obavljeno" ovde znači.** Posao ne zna da li je klijentkinja došla; on samo
kaže da je termin prošao. Svaki potvrđen termin čiji je dan prošao (po vremenu
salona) postaje `completed`, a u istoriji termina stoji da je to uradio sistem.
Ono što je vlasnica već obeležila kao nedolazak ostaje nedolazak. To ima
posledice: `completed` je jedino što od klijentkinje pravi „poznatog" klijenta
(viši limit budućih termina pri zakazivanju), a kartica klijentkinje ga prikazuje
kao „Došla". Ko nije došao a vlasnica to nije označila, računa se kao da jeste.
Da li to treba promeniti (npr. poseban status „prošlo, nije potvrđeno") je odluka
proizvoda i nije donesena.

Bez `VAPID_*` ključeva obaveštenja se prosto ne uključuju i ostatak
aplikacije radi normalno. `VAPID_SUBJECT` je `mailto:` adresa za koju ti
pretplatnički servisi pišu u slučaju problema. Par ključeva se pravi jednom:

```bash
npx web-push generate-vapid-keys
```

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
