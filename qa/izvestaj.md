# QA izveštaj — 20. avgust 2026.

Revizija grane `claude/resend-free-plan-migration-2euaf4` (commit `e4da592`, „Let a salon
have a second person"), produkcije `doterajme.rs`, Supabase projekta `onoaympwuewxoqtkeguz`,
Vercel projekta `zakazi` i posla `backup.yml`.

Ništa u proizvodu nije menjano. Ništa u produkciji nije menjano — sve interaktivno
testiranje išlo je na lokalnom steku (41 migracija + `seed.sql`), produkcija je samo čitana.

---

## Presuda

**Sam proizvod je spreman — okruženje u kom stoji nije bilo.** Zakazivanje, izolacija
između salona i nova funkcija sa drugim izvođačem rade tačno onako kako `CLAUDE.md`
traži: svaki od 24 pokušaja da se iz jednog salona dođe do tuđih podataka je odbijen,
unija slobodnih termina za „Svejedno mi je" ispravno završi kod one osobe koja je stvarno
slobodna, i baza sama odbija duplu rezervaciju.

**Stanje posle popravki (20. avgust, popodne):** kritični nalaz je zatvoren — preview
isporuke više nisu javne. Od devet ozbiljnih, **šest je popravljeno i provereno**, tri
traže tvoju odluku (novac, DNS, prava na GitHub-u). Od četrnaest sitnih, **osam je
popravljeno**, jedan se pokazao kao **moja greška u merenju** (vidi S1), pet su
kozmetika ili tvoja odluka.

Odgovor na pitanje „sme li ovo da se prodaje": **sada da** — uz jednu ogradu koju ne mogu
da sklonim umesto tebe: baza je na besplatnom planu bez ijedne kopije sa strane provajdera
(O3). Sve ostalo što je blokiralo je otklonjeno.

---

## Šta je popravljeno

Sve dole je izmenjeno, pokrenuto i izmereno ponovo. Ništa nije prijavljeno kao gotovo
bez dokaza da radi.

| | Nalaz | Dokaz da je popravljeno |
|---|---|---|
| **K1** | Preview isporuke javne | produkcija `200`, preview `302` na Vercel prijavu |
| **O1** | Vraćena kopija bez zaštite od duple rezervacije | greške pri uvozu 44 → 1, `exclude` ograničenja 0 → **2** |
| **O2** | Vraćena baza bez ijednog prava | `GRANT` 0 → **155**, `REVOKE` 0 → **44**; `anon` više ne dopire do `delete_tenant` |
| **O4** | Nijedno bezbednosno zaglavlje | svih pet zaglavlja na svakoj proverenoj ruti |
| **O5** | Bela strana 45 s kad baza ne odgovara | sada `app/error.tsx` sa srpskim tekstom i putem nazad |
| **O8** | Boje salona ispod WCAG AA | svih šest pozadina: **0** elemenata ispod praga (bilo 14/13/13/5/5/0) |
| **O9** | Test pada 12 sati dnevno | `test:db` **317/317** (bilo 316/317) |
| **S2** | Prigušen tekst ispod AA | ušlo u istu popravku kao O8 |
| **S3** | `/favicon.ico` vraća 404 i celu stranu | `200 image/x-icon`, 20 707 B |
| **S5** | `@types/web-push` među `dependencies` | prebačen u `devDependencies` |
| **S4** | `lucide-react` se ne koristi (41 MB) | uklonjen |
| **S6** | Ograničenje grešaka zajedničko za sve salone | jedan salon potroši svojih 60, ostali i dalje pišu |
| **S8** | Tri funkcije bez `search_path` | sve tri sada `search_path=public` |
| **S9** | Lokalna prijava ne radi | prijava kroz sandučić na `:54324` radi kao u `README.md` |
| **S14** | Strana obećava Google i kad ga nema | podnaslov prati isti prekidač kao dugme; `data-testid` dodat |

Posle svega: `npm test` **148/148**, `npm run test:db` **317/317**, `npm run lint` čist,
`npm run build` prolazi, `npm run test:e2e` **2/2**.

---

## Kritično (blokira prodaju)

### K1. Svaki preview na Vercelu je javan i radi sa produkcijskom bazom

**Stanje:** POPRAVLJENO — Preview isporuke su zaključane; produkcija odgovara 200, preview 302 na Vercel prijavu.

**Šta sam radio.** Pročitao podešavanja Vercel projekta `zakazi` i pokušao da otvorim
poslednju preview isporuku bez ikakve prijave.

**Šta sam očekivao.** Da je preview zaključan (Deployment Protection), ili bar da ne
nosi produkcijske ključeve.

**Šta se desilo.** Preview je otvoren svakome ko zna adresu, i radi sa istim ključevima
kao produkcija.

**Dokaz.**

```
$ curl -o /dev/null -w "%{http_code}" https://zakazi-4r59ru4b9-zlotvor93.vercel.app/prijava
200

Vercel projekat "zakazi":
  ssoProtection:       None          ← zaštita isporuka je isključena
  passwordProtection:  None
  trustedIps:          None

Promenljive okruženja — 6 stavki, svaka JEDNA vrednost za oba okruženja:
  SUPABASE_SERVICE_ROLE_KEY      target=production,preview   (1 stavka za taj ključ)
  VAPID_PRIVATE_KEY              target=production,preview   (1 stavka za taj ključ)
  NEXT_PUBLIC_SUPABASE_URL       target=production,preview   (1 stavka za taj ključ)
  …
```

Jedna stavka po ključu znači da preview i produkcija dele **istu vrednost** — da preview
gleda u drugu bazu, postojale bi dve odvojene stavke sa različitim vrednostima.

Uz to, Supabase Auth izričito pušta prijavu sa tih adresa:

```
uri_allow_list = https://doterajme.rs/auth/callback, https://www.doterajme.rs/auth/callback,
                 https://zakazi-zlotvor93.vercel.app/**,
                 https://zakazi-*-zlotvor93.vercel.app, https://zakazi-*-zlotvor93.vercel.app/**
```

Znači magična veza poslata sa preview adrese **prolazi do kraja** i daje sesiju nad
produkcijskim podacima.

**Koliko je ozbiljno.** Kritično. Ključ koji zaobilazi RLS ne stiže u pregledač — to sam
proverio i čist je (vidi P8) — ali preview je potpuno funkcionalna kopija aplikacije
spojena na prave klijentkinje i prave brojeve telefona, dostupna svakom ko ima link.
Preview adrese završavaju u komentarima na PR-ovima, a repo je javan (K1 se time množi sa
O6). Sestrinski projekat `sub-19` na istom nalogu **ima** uključenu zaštitu
(`ssoProtection: all_except_custom_domains`), pa ovo nije nepoznanica nego propust.

**Predlog popravke.**
1. Vercel → Project `zakazi` → Settings → Deployment Protection → **Vercel Authentication:
   Standard Protection** (isto što već stoji na `sub-19`). Jedan prekidač.
2. Skloni `SUPABASE_SERVICE_ROLE_KEY` i `VAPID_PRIVATE_KEY` sa `preview` okruženja —
   ostavi ih samo na `production`. Preview onda ne može da radi ono što traži te ključeve,
   što je i poenta.
3. Iz `uri_allow_list` u Supabase-u izbaci tri stavke sa `zakazi-*…vercel.app`. Kad je
   preview zaključan iza Vercel prijave, ne treba mu ni prijava u aplikaciju.
4. Ako preview ikad treba da bude upotrebljiv, napravi zaseban Supabase projekat za njega
   i dodaj **odvojene** stavke promenljivih sa `target=preview`.

---

## Ozbiljno (popraviti pre šireg puštanja)

### O1. Vraćena rezervna kopija ostaje bez zaštite od duple rezervacije

**Stanje:** POPRAVLJENO — Proba vraćanja sad instalira `btree_gist` i proverava ograničenja; greške pri uvozu 44 → 1, `exclude` ograničenja 0 → 2.

**Šta sam radio.** Ponovio `pg_dump` sa tačno istim zastavicama kao `backup.yml`, pa ga
vratio u prazan `postgres:17-alpine`, i drugi put u kontejner u kom sam prethodno napravio
role kakve pravi Supabase (`anon`, `authenticated`, `service_role`…) — to je stvarno
odredište oporavka.

**Šta sam očekivao.** Da vraćena baza ima sve što i original: podatke, politike,
ograničenja, indekse, funkcije.

**Šta se desilo.** Podaci, politike, indeksi i funkcije se vrate. **Oba `exclude using
gist` ograničenja se ne vrate**, jer dump ne nosi `create extension btree_gist`.

**Dokaz.**

```
$ pg_dump --schema=public --schema=auth --no-owner --no-privileges --quote-all-identifiers
  CREATE TABLE                 39
  CREATE POLICY                39
  CREATE INDEX                 64
  ADD CONSTRAINT              105
  EXCLUDE USING                 2      ← ograničenja JESU u fajlu
  CREATE EXTENSION              0      ← ali proširenje koje im treba NIJE

$ psql < dump.sql        (u odredište sa Supabase rolama)
  2 × ERROR:  data type uuid has no default operator class for access method "gist"

                      original   vraćeno
  tabela                    16        16
  RLS politika              39        39
  EXCLUDE ograničenja        2         0     ← appointments_no_overlap i
  btree_gist                 1         0        working_hours_no_overlap NESTALI
```

`CLAUDE.md`, nepregovarljivo pravilo br. 3: „Dupla rezervacija se sprečava u bazi."
U vraćenoj bazi se ne sprečava nigde. Aplikacija bi radila i tiho primala dva termina
na isti sat kod iste osobe.

Gore od toga: **posao to ne primeti.** Korak „Proba vraćanja" broji samo redove, prijavi
44 reda grešaka i nastavi:

```
Prijava pri uvozu: 44 redova.
  tenants: 3 ✓        appointments: 26 ✓      services: 16 ✓
  clients: 11 ✓       appointment_events: 50 ✓ working_hours: 19 ✓
Vraćanje provereno: svaki red iz kopije je u bazi.
```

**Koliko je ozbiljno.** Ozbiljno. Ne gubi podatke i ne otvara ih — ali ruši jedinu
garanciju zbog koje se ovaj proizvod kupuje, i to tiho, tačno u trenutku kad je salon
najranjiviji.

**Predlog popravke.** U koraku „Proba vraćanja", pre `psql < dump.sql`, dodaj:

```bash
docker exec proba psql -U postgres -d postgres -c 'create extension if not exists btree_gist;'
```

pa uz brojanje redova dodaj i proveru da se sve vratilo:

```bash
for par in "pg_constraint|contype='x'|2" "pg_policy|true|39"; do … done
# konkretno: broj EXCLUDE ograničenja i broj politika mora da se poklopi sa originalom,
# inače posao pada — isto kao što već pada kad se redovi ne poklope.
```

U pisanom postupku oporavka (O3) prvi korak posle pravljenja projekta mora biti
`supabase db push` (sve migracije), pa tek onda uvoz **samo podataka**.

### O2. Vraćena baza nema nijedno pravo — aplikacija nad njom ne radi

**Stanje:** POPRAVLJENO — `--no-privileges` uklonjen; u kopiji 155 `GRANT` i 44 `REVOKE`, `anon` više ne dopire do `delete_tenant`.

**Šta sam radio.** Isto vraćanje kao u O1, pa proverio šta `anon` i `authenticated` smeju.

**Šta sam očekivao.** Da se prava vrate zajedno sa šemom.

**Šta se desilo.** `--no-privileges` izbaci baš sve `grant` i `revoke` naredbe.

**Dokaz.**

```
$ grep -c '^GRANT'  dump.sql   →  0
$ grep -c '^REVOKE' dump.sql   →  0

Broj funkcija koje anon sme da zove (od 24 proverene):
  original:  0
  vraćeno:  24     ← uključujući delete_tenant, create_tenant, set_tenant_suspended
```

**Dobra vest:** proverio sam da li se to može zloupotrebiti — **ne može.** Sve puca
zatvoreno, jer `is_platform_owner()` za `anon` vraća `false`, a tabelarnih prava nema
uopšte:

```
admin_salons() kao ANON            →  0 salona
create_tenant() kao ANON           →  {"ok": false, "reason": "not_allowed"}
delete_tenant() kao ANON           →  ERROR: permission denied for table tenants
select from clients kao ANON       →  ERROR: permission denied for table clients
```

**Koliko je ozbiljno.** Ozbiljno, ali kao problem **oporavka**, ne bezbednosti. Posle
vraćanja aplikacija je mrtva dok se cela dozvolna ravan ne odsvira ponovo. Ako se to
otkrije tek na dan kvara, „oporavak za pola sata" postaje ceo dan.

**Predlog popravke.** Isti kao O1: oporavak ide kroz `supabase db push` pa uvoz podataka.
Ako se zadržava vraćanje celog dumpa, izbaci `--no-privileges` i dodaj `--no-owner` sam
(prava se onda vrate, vlasništvo ne).

### O3. Jedina kopija je ona iz GitHub Actions — Supabase je na besplatnom planu

**Stanje:** TRAŽI TVOJU ODLUKU — Odluka o novcu — Supabase Pro. Detalji na kraju izveštaja.

**Šta sam radio.** Pitao Supabase Management API za stanje kopija i plan organizacije.

**Šta se desilo.**

```
GET /projects/onoaympwuewxoqtkeguz/database/backups
  {"region":"eu-central-1","pitr_enabled":false,"walg_enabled":true,"backups":[],…}

GET /organizations/navyiymdkipskyssdhip
  {"name":"Sub-19","plan":"free"}
```

`pitr_enabled: false`, `backups: []`, plan `free`. Na besplatnom planu Supabase ne daje
kopiju koju možeš da vratiš, a Point-in-Time Recovery ne postoji ni kao opcija.

**Koliko je ozbiljno.** Ozbiljno. Najgori slučaj gubitka je **do 24 sata rada** — a to je
ceo dan zakazivanja koji salon nema gde da pročita, jer je sveska odavno bačena.
Besplatan plan uz to pauzira neaktivne projekte; treći projekat na istom nalogu
(`Sub19`) je već `INACTIVE`.

Dobra vest: posao **jeste** dvostruk. R2 nije preskočen, korak je stvarno prošao:

```
Slanje na Cloudflare R2   status: completed, conclusion: success
upload: ./zakazi-2026-08-20.sql.gz.age to s3://***/zakazi-2026-08-20.sql.gz.age
Slanje u privatni repo    status: completed, conclusion: success
```

**Predlog popravke.** Pre prvog plaćenog korisnika: Supabase Pro (25 $/mes) uključuje
dnevne kopije, a PITR je dodatnih 100 $/mes za 7 dana. Ako je 100 $ previše na početku,
Pro sam po sebi svodi gubitak sa 24 h na ono što daju njihove dnevne kopije, i sklanja
rizik da se projekat pauzira. Do tada, u `backup.yml` promeni `cron` na dva puta dnevno
(`20 1,13 * * *`) — gubitak pada sa 24 h na 12 h besplatno.

### O4. Nijedno bezbednosno zaglavlje nije postavljeno

**Stanje:** POPRAVLJENO — Svih pet zaglavlja stiže na svakoj proverenoj ruti.

**Šta sam radio.** `curl -sI https://doterajme.rs` i isto nad `/dashboard`, `/prijava`,
`/studio-milica`.

**Šta se desilo.** `next.config.ts` je prazan, pa stiže samo ono što Vercel doda sam.

**Dokaz.**

```
$ curl -sI https://doterajme.rs | sort
  strict-transport-security: max-age=63072000      ← jedino što postoji (Vercel)
  access-control-allow-origin: *
  cache-control: public, max-age=0, must-revalidate
  …
```

Nedostaju: `Content-Security-Policy`, `X-Frame-Options` / `frame-ancestors`,
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.

**Koliko je ozbiljno.** Ozbiljno. Najkonkretnije: bez `frame-ancestors` bilo ko sme da
uglavi `doterajme.rs` u svoj `<iframe>` i preko njega navede korisnicu da otkaže termin
ili obriše uslugu (clickjacking). Ostalo je dubinska odbrana.

**Predlog popravke.** U `next.config.ts`:

```ts
const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      ],
    }];
  },
};
```

**Šta može da pukne kad se doda:** ova četiri ne diraju ništa u aplikaciji — nema
`<iframe>`-a, nema kamere ni geolokacije. `includeSubDomains` je jedina stavka koja traži
pažnju: veže **sve** poddomene na HTTPS, uključujući `send.doterajme.rs` koji koristi
Resend; proveri da tamo ništa ne ide preko HTTP-a pre nego što dodaš `preload`.

CSP ostavi za posebnu izmenu: Next.js sa `--turbopack` ubacuje inline `<script>`, pa CSP
traži `nonce` kroz middleware. Uradi je zasebno, prvo u `Content-Security-Policy-Report-Only`.

### O5. Kad baza ne odgovara, klijent gleda belu stranu 45 sekundi

**Stanje:** POPRAVLJENO — Rok od 8 s u samom klijentu; umesto bele strane sad se prikaže `app/error.tsx`.

**Šta sam radio.** Zaustavio PostgREST kontejner i u čistom pregledaču otvorio javnu
stranu salona.

**Šta sam očekivao.** `app/error.tsx` — srpski tekst, dugme „Pokušaj ponovo", put nazad.

**Šta se desilo.**

```
goto pukao posle 45.0 s: page.goto: Timeout 45000ms exceeded
vreme do ekrana: 72.8 s
ŠTA KORISNIK VIDI: (PRAZNA BELA STRANA)
srpski tekst? NE

$ curl http://localhost:3000/studio-milica
curl: (28) Operation timed out after 30002 ms with 0 bytes received
```

**Koliko je ozbiljno.** Ozbiljno. `app/error.tsx` je dobro napisan i tačno predviđa ovaj
scenario u svom komentaru — ali se nikad ne prikaže, jer server komponenta **visi** umesto
da pukne. Nijedan poziv u `lib/db/` nema rok. Ista lekcija je već naučena u
`prijava/actions.ts` (`SEND_TIMEOUT_MS = 8_000`, uz komentar da poziv koji visi „sruši celu
stranu"), samo nije primenjena na pristup podacima.

**Ograda:** simulirao sam kvar gašenjem PostgREST-a, pa Kong drži vezu otvorenom. Pravi
Supabase ispad bi verovatno brže vratio 5xx. Ali odsustvo roka je činjenica iz koda, ne
pretpostavka.

**Predlog popravke.** Jedan omotač u `lib/db/`, po uzoru na onaj koji već postoji u
prijavi:

```ts
const DB_TIMEOUT_MS = 8_000;
function withTimeout<T>(work: PromiseLike<T>): Promise<T> { … }
```

pa ga provuci kroz svaki `supabase.rpc(...)` poziv. Kad istekne — baci grešku, i
`app/error.tsx` konačno dobije priliku da se pokaže.

### O6. `main` nije zaštićen, repo je javan, a migracije se primenjuju same

**Stanje:** TRAŽI TVOJU ODLUKU — Traži admin prava na GitHub-u koja moj token nema. Koraci na kraju izveštaja.

**Šta sam radio.** Proverio vidljivost repoa i zaštitu grane.

**Šta se desilo.**

```
GET /repos/Zlotvor92/ZAKAZI        →  "private": false, "visibility": "public"
GET /repos/Zlotvor92/ZAKAZI/rulesets  →  []           (nema nijednog pravila)
list_branches                      →  main, "protected": false
```

Uz to, iz `README.md`: Supabase-ova GitHub integracija prati `main` i **na svaki push
sama primeni sve migracije** na produkcijsku bazu, za tridesetak sekundi.

**Koliko je ozbiljno.** Ozbiljno. Jedan pogrešan push na `main` stiže do produkcijske baze
pre nego što iko stigne da pogleda CI. Nema PR-a, nema provere, nema koraka unazad. Za
projekat sa jednim autorom to je podnošljivo dok se ne omakne — a pravilo iz `README.md`
(„migracije pišu se tako da stara verzija koda preživi novu bazu") je jedina brava, i ona
je u glavi, ne u alatu.

**Dobra vest:** pretražio sam celu istoriju (51 commit) — **nijedna tajna nikad nije
commit-ovana.** Svi pogoci su imena tajni u komentarima i `${{ secrets.X }}` izrazima:

```
AGE-SECRET-KEY-        commitova: 0
eyJhbGciOiJIUzI1NiI    commitova: 0
SUPABASE_SERVICE_ROLE_KEY=  commitova: 0
```
`.gitignore` ispravno isključuje `.env*` uz izuzetak `.env.example`.

**Predlog popravke.** GitHub → Settings → Rules → New ruleset za `main`: „Require a pull
request before merging" + „Require status checks to pass" (posao `Provere` i `Baza`).
Sam sebi i dalje možeš da odobriš PR, ali migracija više ne može da sklizne na produkciju
mimo zelenog CI-ja.

### O7. Baza je otvorena ka celom internetu

**Stanje:** TRAŽI TVOJU ODLUKU — Namerno nisam dirao — sužavanje na opsege GitHub runnera može tiho oboriti noćnu kopiju.

**Dokaz.**

```
GET /projects/onoaympwuewxoqtkeguz/network-restrictions
  {"entitlement":"allowed",
   "config":{"dbAllowedCidrs":["0.0.0.0/0"],"dbAllowedCidrsV6":["::/0"]},
   "status":"applied"}
```

**Koliko je ozbiljno.** Ozbiljno, ali ublaženo. `entitlement: allowed` znači da se
ograničenje **može** uključiti. Praktični rizik je pogađanje lozinke `postgres` role, jer
`anon` nema nijedno pravo nad tabelama (vidi P2). Ipak, `SUPABASE_DB_PASSWORD` je jedina
stvar između interneta i cele baze.

**Predlog popravke.** Baza se direktno dodiruje samo iz posla za kopiju. Suzi
`dbAllowedCidrs` na opsege GitHub Actions runnera (`https://api.github.com/meta`, polje
`actions`), ili — jednostavnije — ostavi otvoreno ali uključi obaveznu MFA na Supabase
nalogu i rotiraj lozinku baze. Aplikacija ide preko PostgREST-a i ovo ne dodiruje.

### O8. Salon koji izabere svoje boje ume da dobije nečitljiv tekst

**Stanje:** POPRAVLJENO — Boja teksta se bira merenjem; svih šest pozadina sada 0 elemenata ispod WCAG AA.

**Šta sam radio.** Postavio šest kombinacija boja salona i **izmerio stvarni WCAG odnos
kontrasta u pregledaču**, na 390×844, preko `canvas`-a (da se `oklch()` ispravno razreši).

**Šta se desilo.**

```
pozadina                       elemenata ispod AA   najgori odnos
#ffffff  vrlo svetla                    5              4.48
#999999  srednji ton                   14              1.85   ✗
#777777  srednji ton                   13              2.49   ✗
#b8860b  zlatna                        13              1.98   ✗
#111111  vrlo tamna                     0              —      ✓
#ffd1dc  pastelno roze                  5              4.09
```

Na `#999999`: „Studio Milica" 2.66, „Šta zakazuješ?" 2.66, „Gel nokti" 2.66,
„1 h 30 min" 1.85.

**Uzrok.** `lib/domain/brand.ts:30` — `isDark()` koristi prag luminanse **0.35**. Pozadine
tik ispod tog praga dobiju svetao tekst `#f7f7f7`, koji na srednjem tonu ne vredi ništa.
Na `#999999` bi taman tekst dao **6.64** umesto 2.66 — dakle boja nije problem, izbor je.

**Koliko je ozbiljno.** Ozbiljno za salone koji koriste boje (a to je razlog zbog kog se
prelazi na viši plan). Podrazumevana tema je **čista** — izmerio sam tri strane, nula
elemenata ispod AA. Pogađa samo one koji su boje postavili.

**Predlog popravke.** U `lib/domain/brand.ts`, ne birati po pragu nego po tome šta stvarno
daje bolji kontrast, i sa čistim belim/crnim da presek nikad ne padne ispod 4.5:

```ts
function contrast(a: string, b: string): number { /* (L1+0.05)/(L2+0.05) */ }

function foregroundFor(background: string): string {
  return contrast(background, "#ffffff") >= contrast(background, "#000000")
    ? "#ffffff"
    : "#000000";
}
```

Uz to podigni `--muted-foreground` sa `58%` na `72%` — to je zaseban nalac, vidi S2.

### O9. Test `subscription-expiry` pada dvanaest sati svakog dana

**Stanje:** POPRAVLJENO — Test koristi dve zone 26 sati razmaknute; `test:db` 317/317 u svako doba dana.

**Šta sam radio.** Pokrenuo `npm run test:db`.

**Šta se desilo.** 316 od 317 prošlo; pao jedan.

```
FAIL tests/db/subscription-expiry.test.ts > računanje isteka > dan se meri po salonu, ne po serveru
AssertionError: expected true to be false
```

**Uzrok.** Test pretpostavlja da je datum na Kiritimatiju (UTC+14) **uvek** ispred
beogradskog. To važi samo dok je UTC sat između 10 i 22:

```
 UTC | Kiritimati | Beograd    | ishod
   0 | 2026-08-20 | 2026-08-20 | test PADA
   …
   9 | 2026-08-20 | 2026-08-20 | test PADA
  10 | 2026-08-21 | 2026-08-20 | test PROLAZI
   …
  21 | 2026-08-21 | 2026-08-20 | test PROLAZI
  22 | 2026-08-21 | 2026-08-21 | test PADA
  23 | 2026-08-21 | 2026-08-21 | test PADA
```

**Sama funkcija je ispravna** — proverio sam `subscription_expired` u bazi, meri dan po
tajmzoni salona kako i treba. Greška je isključivo u testu.

**Koliko je ozbiljno.** Ozbiljno kao proces, ne kao proizvod. CI je crven od 22:00 do
10:00 UTC — to je od ponoći do podne po Beogradu, tačno kad se radi na ovome. Crven CI
koji se ignoriše prestaje da bude alarm, a `main` nema zaštitu (O6) pa je CI ionako jedina
provera koja postoji.

**Predlog popravke.** Zameniti „sad" fiksnim trenutkom, da test ne zavisi od sata:

```sql
-- umesto now(): trenutak u kom Kiritimati i Beograd sigurno nisu isti dan
select subscription_expired('2026-08-20'::date, 'Pacific/Kiritimati') as ostrvo,
       subscription_expired('2026-08-20'::date, 'Europe/Belgrade')    as beograd
-- uz set local "time zone" ili zamrznut now() kroz pg_catalog
```

---

## Sitno (kozmetika i udobnost)

### S1. ~~56 meta za dodir je manje od 44×44 px~~ — ISPRAVKA: bilo ih je najviše troje

**Ovo je bila moja greška, ne greška proizvoda.** Ostavljam je u izveštaju u punom obliku
jer nalaz bez ispravke je gori od nenapisanog nalaza.

**Šta sam prvo uradio.** Izmerio `getBoundingClientRect()` svakog `button`, `a`, `input` i
`select` na devet ekrana i prijavio svaki koji je niži od 44 px. Dobio 56 i napisao da je
„problem na ekranima vlasnice, najgore u podešavanjima".

**Šta sam propustio.** Kod to **već rešava**, i to pažljivo — samo ne na način koji se vidi
iz `getBoundingClientRect()`:

```
components/ui/button.tsx:21
  sm: "h-9 rounded-md px-3 after:absolute after:inset-x-0 after:top-1/2
       after:h-11 after:-translate-y-1/2 after:content-['']"
       ← vidljivo ostaje 36 px, dodirna zona se nevidljivo razvlači na 44 px

settings-forms.tsx:175
  {/* Kvačica je 20px, ali se dodiruje ceo red visok 44px. */}
  <label className="flex min-h-11 items-center gap-2">
       ← meta je labela, ne kvadratić od 20 px
```

**Šta sam onda uradio.** Napisao merenje koje gađa tačke oko centra mete i pita
`document.elementFromPoint` da li se i dalje pogađa ta kontrola — dakle **stvarnu dodirnu
zonu**, sa `::after` proširenjem i labelom koja aktivira kvačicu (`qa/a23-dodirne-zone.mjs`).

**Dokaz da `::after` radi.** Sonda kroz centar dugmeta „Sačuvaj" u podešavanjima:

```
visina elementa: 36 px, ::after visina: 44px, position: relative
-26:form  -24:form  -22:button … +0:button … +22:button  +24:form  +26:form
                    └──────────── pogađa se 45 px ────────────┘
```

**Rezultat ispravnog merenja.**

```
                        prvo merenje    stvarna dodirna zona
/                             1                 0
/studio-milica                0                 0
/studio-milica/otkazi         0                 0
/dashboard                    6                 0
/dashboard/podesavanja       30                 0*
/dashboard/termin/novi        0                 0
/admin                       15                 1  → popravljeno
UKUPNO                       56                 1
```

\* Direktno merenje visine labele: svih 9 kvačica = 44 px. Ono što je sonda povremeno
prijavljivala kao 35 px je bila meta pri samoj ivici prozora, gde sonda naiđe na kraj
ekrana i to pročita kao kraj mete.

**Jedina prava sitnica** je bila polje za datum u konzoli platforme:

```
app/(dashboard)/admin/salon-list.tsx:170
-  className="h-9 w-auto text-sm"
+  className="h-11 w-auto text-sm"
```

**Koliko je ozbiljno.** Sitno, i sad popravljeno. Ali pouka je veća od nalaza: mera za
dodirnu metu nije pravougaonik elementa nego ono što prst stvarno pogodi, a ovaj kod je to
rešio bolje nego što sam ga prvi put pročitao.

### S2. Prigušen tekst od 12 px pada ispod AA na svakoj svetloj pozadini salona

**Stanje:** POPRAVLJENO — Ušlo u istu popravku kao O8.

Iz istog merenja kao O8: `--muted-foreground` je
`color-mix(in srgb, foreground 58%, background)`, što daje 4.48 na beloj i 4.09 na
pastelno roze — oboje ispod 4.5. Pogađa trajanja („1 h 30 min"), veze u podnožju i
napomene ispod polja. **Podrazumevana tema ovo nema** — tamo je `oklch(0.556 0 0)` i prolazi.

**Predlog.** `58%` → `72%` u `lib/domain/brand.ts:65`.

### S3. `/favicon.ico` vraća 404 i uz njega celu stranu „nema salona"

**Stanje:** POPRAVLJENO — `public/favicon.ico` postoji; odgovor je `200 image/x-icon`.

```
$ curl -o /dev/null -w "%{http_code} %{size_download}" http://localhost:3000/favicon.ico
404 29172
```

`[tenantSlug]` hvata `/favicon.ico`, pa svaki pregledač koji ga zatraži dobije 29 KB
HTML-a umesto ikone. Vidi se i u dnevniku (`GET /favicon.ico 404 in 165ms`) i kao jedina
konzolna greška na javnim stranama. **Predlog:** stavi `favicon.ico` u `public/` — tamo se
razrešava pre rutiranja, isto kao `sw.js` i ostale ikone (README to već objašnjava).

### S4. `lucide-react` se ne koristi nigde, a nosi 41 MB

**Stanje:** POPRAVLJENO — `lucide-react` uklonjen.

```
lucide-react: 0 uvoza          41M  node_modules/lucide-react
```
**Predlog:** `npm uninstall lucide-react`.
(Proverio sam i `date-fns` — **nije** višak: `date-fns-tz` ga traži kao peer zavisnost
`^3.0.0 || ^4.0.0`, pa je ispravno naveden.)

### S5. `@types/web-push` stoji među `dependencies`

**Stanje:** POPRAVLJENO — `@types/web-push` prebačen u `devDependencies`.

Paket sa tipovima ide u `devDependencies`; ovako se povlači i u produkcijski build.

### S6. Ograničenje dnevnika grešaka je zajedničko za sve salone

**Stanje:** POPRAVLJENO — Broji se po salonu, uz zajednički krov; jedan salon više ne gasi dnevnik ostalima.

```sql
if (select count(*) from error_events
    where occurred_at > now() - interval '1 minute') >= 60 then
```
Nema `tenant_id` u uslovu. Poslao sam 60 grešaka zaredom — svih 60 upisano, 61. i dalje
ćutke odbačene (i to je ispravno: strana koja se već raspala ne sme da dobije još jednu
grešku). Ali salon koji uđe u petlju ugasi dnevnik **svima ostalima** na taj minut.
**Predlog:** dodaj `and tenant_id = p_tenant_id` u brojanje, uz manji globalni krov.

### S7. `btree_gist` je u `public` šemi

Potvrđeno i lokalno i Supabase-ovim savetnikom (`extension_in_public`). Zbog toga se u
`public` slije ~180 `gbt_*` funkcija, što je i razlog zašto spisak prava izgleda bučno.
**Predlog:** `alter extension btree_gist set schema extensions;` u novoj migraciji — ali
tek pošto se sredi O1, jer dodiruje ista ograničenja.

### S8. Tri funkcije bez `set search_path`

**Stanje:** POPRAVLJENO — Sve tri funkcije imaju `search_path=public`.

`add_minutes`, `set_updated_at`, `appointment_status_allowed` (uz `timerange` /
`timemultirange` iz `btree_gist`). Sve su `security invoker`, pa je rizik mali — ali
**nijedna `security definer` funkcija nije bez `search_path`, sve 50 su čiste**, pa je
šteta ostaviti ove tri da bućkaju savetnik.

### S9. Lokalna prijava iz `README.md` ne radi sa trenutnim Supabase CLI-jem

**Stanje:** POPRAVLJENO — `[auth.email] enable_signup = true`; prijava kroz sandučić radi kao u `README.md`.

```
$ supabase start && otvori /prijava
signInWithOtp nije uspeo: Email logins are disabled (status 422)

$ docker exec supabase_auth_doterajme env | grep EMAIL
GOTRUE_EXTERNAL_EMAIL_ENABLED=false
```

`supabase/config.toml` ima `[auth.email] enabled = true`, ali predložak koji CLI 2.115
sam generiše **nema ključ `enabled`** u toj sekciji — tiho se ignoriše. **U produkciji je
sve u redu** (`external_email_enabled: True`), ovo je isključivo lokalno.

**Posledica za mene:** prijavu sam morao da dobijem kroz admin API
(`/auth/v1/admin/generate_link`) pa da token provučem kroz pravu `/auth/callback` rutu —
ista ruta, samo drugačiji izvor linka. Sandučić na `:54324` nikad nije dobio nijednu poruku.

**Predlog:** proveriti u dokumentaciji CLI-ja koji ključ danas pali mejl provajder i
uskladiti `config.toml`, ili u `README.md` dopisati kako se prijaviti dok to ne bude
sređeno.

### S10. Salon na pauzi ostavlja klijentkinje bez načina da otkažu

```
stanje salona                javna strana   strana otkazivanja
normalno                     200            200  ✓
javno zakazivanje isključeno  404 ✓          200  ✓   ← traženo ponašanje
pretplata istekla             404 ✓          200  ✓   ← traženo ponašanje
salon pauziran                404            404  ←
```

Traženo ponašanje za prva dva slučaja radi tačno. Za pauziran salon je i otkazivanje
zatvoreno — namerno, `public_cancel_appointment` gleda samo `suspended_at`. Ali
klijentkinja sa zakazanim terminom tad nema nijedan način da javi da ne dolazi, a salon je
i dalje čeka. **Predlog:** odluka je tvoja; ako ostaje ovako, bar zameni tekst u nešto
poput „Javi se salonu direktno".

### S11. `.ics` kalendar salona nosi cele brojeve telefona

```
DESCRIPTION:+381641000002\nJovana
```

Adresa je zaštićena tokenom i rotacija radi (vidi P6), i vlasnici broj treba da bi
pozvala. Ali uputstvo u aplikaciji kaže da se adresa nalepi u `calendar.google.com` —
posle toga spisak brojeva klijentkinja stoji na Google-ovim serverima. Vredi da bude
svesna odluka, ne slučajna. **Predlog:** rečenica u politici privatnosti, ili prekidač
„bez brojeva u kalendaru".

### S12. `npm audit`: tri visoke, sve iz `next`, nijedna ne dodiruje ovaj kod

```
postcss <=8.5.22   ← next 15.5.23 nosi postcss 8.4.31 (alat za build)
sharp   <0.35.0    ← next nosi sharp 0.34.5 (obrada slika u build-u)
fix available via `npm audit fix --force` → next@16.3.1 (prelomna izmena)
```

Obe su u lancu `next → …`, obe rade u toku build-a, ne u zahtevu korisnika. `postcss`
ranjivosti traže da napadač podmetne CSS koji se build-uje; `sharp`/libvips traže
podmetnutu sliku. Aplikacija ne obrađuje slike koje korisnik pošalje kroz `next/image`
(logo ide u Supabase Storage). **Predlog:** ne dizati `next` na 16 zbog ovoga; pratiti
`15.x` zakrpu. CI ovo već tretira kao informativno (`continue-on-error: true`), što je
tačna procena.

### S13. DMARC je na `p=none`

**Stanje:** TRAŽI TVOJU ODLUKU — DNS zapis — moraš ti. Tačan zapis na kraju izveštaja.

```
_dmarc.doterajme.rs  "v=DMARC1; p=none; rua=mailto:zakazii.rs@gmail.com"
```
SPF i DKIM su **ispravno** postavljeni (`send.doterajme.rs` → `v=spf1 include:amazonses.com ~all`,
`resend._domainkey` postoji), pa poravnanje prolazi preko DKIM-a. **Predlog:** kad izveštaji
na `rua` budu dve nedelje čisti, pređi na `p=quarantine; pct=25`, pa postepeno na 100.

### S14. Sitnice bez posledica

**Stanje:** POPRAVLJENO — Podnaslov prati isti prekidač kao dugme; `data-testid="staff-any"` dodat.

- Strana za prijavu kaže „Google nalogom ili linkom na mejl" i kad je Google isključen
  (`sr.signIn.subtitle` je nepromenljiva niska, dugme je iza `GOOGLE_ENABLED`). U produkciji
  je Google uključen pa se ne vidi; lokalno zbunjuje.
- Dugme „Svejedno mi je" nema `data-testid`, za razliku od ostalih koraka toka. Sitno
  otežava pisanje testova baš za korak koji je nov.
- Zakazan posao kopije je krenuo u 02:31 UTC iako `cron` kaže 01:20 — GitHub kasni sa
  zakazanim poslovima i ume da ih preskoči na neaktivnim repoima. Traka u konzoli to
  pokriva stanjem `stale` posle 26 h, što je dobro rešeno.

---

## Provereno i ispravno

Ovo nisu pretpostavke — svaka stavka je proverena i ima izlaz iza sebe.

### P1. Izolacija između salona — 24 pokušaja, 24 odbijena

Napravio dva salona sa po jednim vlasnikom i iz salona A napao sve što pripada salonu B.

```
ČITANJE (svaki broj mora biti 0):
  tenants_B 0 | clients_B 0 | appts_B 0 | staff_B 0 | services_B 0
  events_B  0 | wh_B 0 | memb_B 0 | block_B 0 | push_B 0

UPIS:
  update tuđih klijenata            → UPDATE 0
  update tuđih termina              → UPDATE 0
  update tuđeg salona               → ERROR: permission denied for table tenants
  insert termina u tuđi salon       → ERROR: new row violates row-level security policy
  insert klijenta u tuđi salon      → ERROR: new row violates row-level security policy
  ESKALACIJA: članstvo u tuđi salon → ERROR: new row violates row-level security policy
  ESKALACIJA: sebe u platform_owners→ ERROR: new row violates row-level security policy

RPC sa TUĐIM id-jem:
  tenant_staff(B)              → PRAZNO          set_staff(…, B)        → not_allowed
  set_staff(preimenuj tuđeg)   → not_allowed     deactivate_staff(tuđi) → not_allowed
  dashboard_week(B)            → NULL            upsert_service(u B)    → not_found
  upsert_service(tuđu uslugu)  → not_found       set_working_hours(tuđem) → no_staff
  add_time_off(tuđem)          → no_staff        change_appointment_status(tuđi) → not_found
  block_appointment_client(tuđi)→ not_found      appointment_history(tuđi) → []
  set_calendar_token(B)        → not_allowed     clear_calendar_token(B) → not_allowed
  set_tenant_brand(B)          → not_allowed     set_tenant_logo(B)     → not_allowed
  delete_tenant(B)             → not_allowed     set_tenant_suspended(B)→ not_allowed
  set_tenant_paid_until(B)     → not_allowed     create_tenant()        → not_allowed
  admin_salons()               → 0 redova        recent_errors()        → 0 redova
```

Nijedan izuzetak. Objašnjenja odbijanja su uz to pažljiva — `deactivate_staff` prvo
proverava pripadnost pa tek onda „poslednja je", da poruka o grešci ne oda ništa o tuđem
salonu.

### P2. `anon` ne vidi nijednu tabelu

Svih 16 tabela u `public`, kao `anon`:

```
tenants, memberships, staff, services, staff_services, working_hours, time_off, clients,
appointments, appointment_events, blocklist, messages, push_subscriptions, error_events,
platform_owners, phone_lookup_attempts
   → svih 16: ERROR: permission denied for table …
```

Provera prava potvrđuje: `anon` nema **nijedno** tabelarno pravo. `authenticated` ima
prava na 15 tabela, ali svaka od njih ima RLS i politike. `error_events`,
`phone_lookup_attempts` i `platform_owners` namerno imaju RLS bez ijedne politike — pristup
ide isključivo kroz `security definer` funkcije. Supabase savetnik to prijavljuje kao
`INFO`, što je tačno: to je najstroža moguća postavka, ne propust.

### P3. RLS je uključen svuda, `security definer` funkcije su čiste

```
tabela sa RLS: 16/16 uključeno
security definer funkcija bez set search_path: 0        ← nijedna
funkcije koje anon sme da zove (aplikacijske): 7
   calendar_feed, log_error, public_appointments_for_phone, public_book,
   public_booking_data, public_cancel_appointment, public_salon_summary
```

Tačno javna površina koju `CLAUDE.md` predviđa — zakazivanje, otkazivanje, javni podaci
salona, prijava greške, i kalendar (koji ne može da se prijavi). Ništa preko toga.

### P4. Dupla rezervacija se sprečava u bazi

```sql
appointments_no_overlap  EXCLUDE USING gist (staff_id WITH =, blocked_range WITH &&)
                         WHERE (status = ANY (ARRAY['pending','confirmed']))
working_hours_no_overlap EXCLUDE USING gist (staff_id WITH =, weekday WITH =,
                         timerange(start_time, end_time, '[)') WITH &&)
btree_gist: uključen
```

Ograničenje je **po osobi**, ne po salonu — što je i tačno otkad ih ima dvoje. Provereno
kroz oba puta upisa: javni (`public_book` → `slot_taken`) i ručni
(`create_appointment` → „To vreme je već zauzeto.").

### P5. Drugi izvođač — najvažnija provera u aplikaciji, prolazi u celini

Ovo je nova funkcija i testirao sam je najtemeljnije.

```
Sa JEDNIM izvođačem:  broj staff-option dugmadi: 0   → koraka „Kod koga?" nema, tok
                                                       nepromenjen, nijedan dodir više ✓
Sa DVOJE:             „Kod koga? Milica | Jovana | Svejedno mi je" ✓

Zauzmem Milici 10:30, pa kao nov klijent:
  A. „Svejedno mi je" nudi:  10:30 17:00 18:30    → 10:30 JE i dalje u ponudi ✓ (unija)
     zakazujem 10:30         → BAZA: izvođač = JOVANA ✓ (ode kod one koja je slobodna)
  B. izričito „Milica" nudi:  17:00 18:30         → 10:30 sklonjen ✓
  C. „Svejedno" posle toga:   17:00 18:30         → 10:30 nestao ✓ (oboje zauzeti)
```

Provereno i preko izmenjenog zahteva, mimo interfejsa:

```
p_staff_id = Milica na zauzet 10:30   → slot_taken      ← ne prebacuje tiho na drugu ✓
p_staff_id = izvođač iz TUĐEG salona  → unknown_service ← adresa se ne da prepraviti ✓
```

Nova osoba nasleđuje sve od prve, kao što opis kaže:

```
  Milica  aktivna  3 usluge  11 radnih dana
  Jovana  aktivna  3 usluge  11 radnih dana      ← identično nasleđeno
```

Treća osoba se ne nudi uopšte — kad ih je dvoje, polje i dugme „Dodaj osobu" nestanu.
To je bolje od poruke o grešci, a baza svejedno drži branu (`too_many`).

U kalendaru se ime izvođača prikazuje **tek kad ih ima dvoje**:
`10:30 Ana Anić Gel nokti · Milica · preko sajta`.

U formi za ručni unos izbor takođe radi:
```
izabrana Jovana → BAZA: izvođač Jovana, staff_id 8e9630ca-… ✓
isti sat kod Jovane opet → „To vreme je već zauzeto." ✓
isti sat kod Milice      → prolazi ✓ (zauzetost je po osobi)
```

### P6. Svaki razlog odbijanja ima svoju srpsku poruku

Izvukao sam **sve** razloge koje baza ume da vrati i uporedio ih sa `lib/i18n/sr.ts`
mehanički:

```
razloga u bazi (15): blocked, booking_closed, invalid_name, invalid_phone, outside_window,
  outside_working_hours, slot_taken, time_off, too_fast, too_many_from_device,
  too_many_from_network, too_many_this_week, too_many_upcoming, too_soon, unknown_service
ključeva u sr.ts (18): … + no_staff, off_grid, invalid_duration

BEZ PREVODA: (prazno) ✓
```

I svaki razlog je zaista **svoj**, ne skupno „zauzeto":

```
u pauzi (sutra 15:00)          → outside_working_hours
posle radnog vremena (22:00)   → outside_working_hours
sat koji nije početak (09:20)  → outside_working_hours
odsustvo oboje                 → time_off
iza horizonta (+400 dana)      → outside_window
u prošlosti                    → outside_window
blokiran broj                  → blocked
neispravan telefon             → invalid_phone
prazno ime / ime od 200 znakova→ invalid_name
```

U pregledaču se to i vidi kao ljudska rečenica — treći termin iste nedelje daje:
„Već imaš dva termina te nedelje. Izaberi drugi datum ili otkaži jedan."

(Jedina sitnica: termin u **prošlosti isti dan** vrati `too_soon` umesto
`outside_working_hours`, jer se rok proverava pre radnog vremena. Poruka je i tako tačna.)

### P7. Audit log — svaka promena ostavlja trag

```
zakazivanje:  from_status null → confirmed,  actor_type client, device_id postoji
„Obavljeno":  confirmed → completed,          actor_type user,   device_id postoji
otkazivanje:  confirmed → cancelled_by_client, actor_type client, device_id postoji
```

Matrica prelaza je tačno ona iz specifikacije, i zabranjeni prelazi se odbijaju:

```
pending             → cancelled_by_client, cancelled_by_salon, confirmed
confirmed           → cancelled_by_client, cancelled_by_salon, completed, no_show
completed           → no_show                    (ispravka greške)
no_show             → completed                  (ispravka greške)
cancelled_by_client → (ništa)                    cancelled_by_salon → (ništa)

completed → confirmed  → {"ok": false, "reason": "invalid_transition"} ✓
completed → pending    → {"ok": false, "reason": "invalid_transition"} ✓
```

`appointment_events` nema `update` ni `delete` politiku — dopisuje se i čita, nikad se ne
menja. To je jedino zbog čega dokaz „ja to nisam otkazala" nešto vredi.

### P8. Nijedna tajna ne stiže u pregledač

Nad izgrađenim `.next/static`:

```
doslovni service_role ključ  → 0 pogodaka
niska "service_role"         → 0 pogodaka
SUPABASE_SERVICE_ROLE_KEY    → 0 pogodaka
VAPID_PRIVATE_KEY            → 0 pogodaka
bilo koji JWT                → 0 pogodaka
```

Isto i u 620 KB JS-a povučenog sa žive preview isporuke. Build prolazi čist.

### P9. Zod stoji na svakoj granici — 10 od 10

```
app/(auth)/prijava/actions.ts                   zod ✓
app/(dashboard)/admin/actions.ts                zod ✓
app/(dashboard)/dashboard/actions.ts            zod ✓
app/(dashboard)/dashboard/termin/novi/actions.ts zod ✓
app/(dashboard)/dashboard/podesavanja/actions.ts zod ✓
app/(public)/[tenantSlug]/actions.ts            zod ✓
app/(public)/[tenantSlug]/otkazi/actions.ts     zod ✓
app/api/kalendar/route.ts                       zod ✓
app/api/kalendar/salon/[token]/route.ts         zod ✓
app/api/greske/route.ts                         zod ✓
```

### P10. Pravilo „bez sirovih upita u komponentama" se poštuje

Nijedan `.tsx` fajl ne pominje Supabase. Tri server akcije uvoze `createClient`, ali
isključivo za `supabase.auth.*` (`signInWithOAuth`, `signOut`, `getUser`) — nijedan
`.from()` ni `.rpc()` van `lib/db/`.

### P11. Prijava, preusmeravanja i granice sesije

```
neprijavljen /dashboard              → /prijava ✓
neprijavljen /admin                  → /prijava ✓
neprijavljen /dashboard/podesavanja  → /prijava ✓
neprijavljen /dashboard/termin/novi  → /prijava ✓
prijavljen /                         → /dashboard ✓
prijavljen /prijava                  → /dashboard ✓

istrošena veza (bez sesije)  → /prijava?greska=1  „Link nije važeći ili je istekao."
izmenjena veza               → /prijava?greska=1  ista poruka
bez parametara               → /prijava?greska=1  ista poruka
provajder odbio              → /prijava?greska=google „Prijava preko Google naloga nije uspela."
```

Nijedna ne obara stranu u belo. **Otvoreno preusmerenje ne postoji** — `redirect_to` na
tuđi domen se ignoriše, ruta uvek vodi na `/dashboard`:

```
/auth/callback?token_hash=x&type=magiclink&redirect_to=https://zlo.example/
   → http://localhost:3000/prijava?greska=1
```

U produkciji middleware radi isto (`/dashboard` bez prijave → `307 → /prijava`), i strane
koje ne smeju u keš to i poštuju (`cache-control: private, no-cache, no-store`).

### P12. Konzola platforme je nevidljiva za ostale

```
običan vlasnik na /admin → HTTP 404, „Ove stranice nema"
```

Pravi 404, ne „zabranjeno" — nema šta da se sazna da postoji. Kao vlasnik platforme radi
sve: spisak salona, pravljenje, pauziranje, brisanje, dnevnik grešaka.

Traka za kopiju baze je rešena tačno kako treba — kad ne može da pročita stanje, kaže
„ne znam", ne „sve je u redu":

```
„Ne mogu da proverim kopiju baze — Stanje posla se trenutno ne čita. Pogledaj ručno."
```

`backup-health.ts` uz to razlikuje `stale` od `failed`, sa komentarom koji objašnjava
zašto: GitHub sam gasi zakazane poslove na mirnim repoima, i to ćutanje je opasnije od pada.

### P13. Otkazivanje od strane klijenta

```
nepoznat broj → „Nema zakazanih termina za taj broj."
poznat broj   → spisak termina sa dugmetom „Otkaži"
prvi dodir    → „Sigurno otkazujem?"            ← potvrda u dva koraka
drugi dodir   → status cancelled_by_client, event confirmed → cancelled_by_client ✓
                „Javi se salonu ako se predomisliš."
```

Otkazani termin nestaje sa spiska, preostali ostaje. Pretraga po broju je uz to
ograničena (`phone_lookup_attempts` + `phone_lookup_limit_reason`), pa se spisak brojeva
ne može prečešljati.

### P14. `.ics` fajlovi su ispravni do slova

```
CRLF prelomi ✓ | charset=utf-8 ✓ | stabilan UID ✓ | dva VALARM-a ✓
DTSTART 09:00+02:00 → 20260821T070000Z ✓
najduži red bez preloma: 75 okteta (RFC 5545 granica 75) ✓
```

Sa dugim srpskim imenom salona, posle odmotavanja:

```
UTF-8 dekodiranje: OK ✓        ← prelamanje ne seče višebajtne znake
SUMMARY:  TAČNO ✓              ← „Nadogradnja … — Salon Čarobnica Lepote Đurđevdanska
LOCATION: TAČNO ✓                 Šišanje i Šminkanje Beograd Vračar"
```

Naši znaci (č, ć, š, ž, đ) prolaze i kroz interfejs i kroz `.ics`. Neispravni parametri
daju 400.

### P15. Kalendar salona i rotacija tokena

```
ispravan token   → HTTP 200, 3 termina
izmišljen token  → HTTP 200, 0 termina    ← prazan kalendar, ne greška: ne odaje se
                                             koji tokeni postoje
smeće umesto UUID-a → 200, prazno

posle rotacije:  stari token → 0 termina ✓   novi token → 3 termina ✓
```

Stara adresa prestaje da radi **istog trena**.

### P16. Zatvaranje salona i istek pretplate

Vidi tabelu u S10 — javna strana se zatvara, **otkazivanje nastavlja da radi**, tačno kako
je traženo. Nepostojeći salon ne odaje da ne postoji:

```
/nema-ovakvog-salona → HTTP 404
  „Doteraj Me — Ovaj salon trenutno ne prima zakazivanje preko interneta."
  <title>Zakazivanje nije dostupno</title>
```

Isti tekst za nepostojeći, isključen i pauziran salon — tri stanja se namerno ne razlikuju,
i naslov je tačan za sva tri (vidi komentar uz `sr.booking.unavailableTitle`).

### P17. Ništa ne izlazi iz ekrana telefona

```
9 ekrana na 390×844 → sa vodoravnim prelivom: 0
gust dan (30 termina u danu) → preliv 0px, 37 redova, visina 2073px
```

Uključujući duga imena, duge nazive usluga i dug link za zakazivanje.

### P18. Statične datoteke i PWA

```
/robots.txt              200  text/plain            (Disallow: /prijava /dashboard /admin
                                                     /auth /api /*/otkazi)
/manifest.webmanifest    200  application/manifest+json
/icon.png                200  image/png   39997 B
/apple-icon.png          200  image/png   18777 B
/icon-192.png            200  /icon-512.png 200  /icon-maskable-512.png 200
/sw.js                   200  application/javascript
```

Sve ikone iz manifesta se stvarno razrešavaju.

### P19. Ograničenja protiv zloupotrebe rade i ne daju se lako zaobići

`booking_limit_reason` drži: 2 termina nedeljno po broju, 4 nadolazeća za novog klijenta
(6 za poznatog), 6 po uređaju, 8 po mreži u sat vremena, 30 s hlađenja po uređaju.
Provereno u pregledaču — treći termin istog broja odbijen sa tačnom porukom. Uređaj se
vodi kroz `httpOnly` kolačić, mreža kroz heš **zasoljen salonom** (`sha256(slug:adresa)`),
pa se ista osoba u dva salona ne može povezati ni sa pristupom bazi.

### P20. Ostalo provereno

- `npm test` — **147 testova, svih 147 prolazi**
- `npm run test:db` — 317 testova, 316 prolazi (jedini pad je O9, greška u testu)
- `npm run build` — prolazi čisto
- `npx playwright test` — oba kritična toka prolaze
- `/api/greske` — 60 upisano, 61. tiho odbačen; poruka od 20 000 znakova odbijena
  Zod-om (`max 500`) i **nije** stigla u bazu; neispravan JSON i prazno telo → 204
- Funkcije rade u Frankfurtu: `x-vercel-id: iad1::fra1::…`, baza `eu-central-1` — isti
  region, GDPR i kašnjenje u redu
- HTTP → HTTPS 308 ✓, `www` → apex 308 ✓
- Postgres 17.6.1.155 — nema čekajućih nadogradnji (`eligible: false`, već je najnovija)
- Podrazumevana tema prolazi WCAG AA na sve tri merene strane (0 elemenata ispod praga)
- Termin van radnog vremena kroz ručni unos je **dozvoljen**, uz napomenu
  „Termin van radnog vremena je dozvoljen — kalendar je tvoj." ✓
- Sav interfejs je na srpskoj latinici, sav kod na engleskom — nijedno odstupanje nađeno
- Supabase Performance Advisor: 13 neindeksiranih stranih ključeva i 2 neiskorišćena
  indeksa. Na ovoj veličini podataka bez posledica; vredi pogledati kad `appointments`
  pređe ~100 000 redova.

---

## Nije provereno — i zašto

1. **Dešifrovanje prave produkcijske kopije.** Privatni `age` ključ nije nigde u GitHub-u
   i nemam ga — to je namerno i tako treba da ostane. **Umesto toga** sam ponovio isti
   `pg_dump` nad lokalnom bazom sa identičnim zastavicama i vratio ga u `postgres:17-alpine`
   dva puta (prazan, pa sa Supabase rolama) — odatle O1 i O2. To pokriva pitanje „šta
   dump nosi", ali **ne** pokriva „da li se baš taj fajl na R2/GitHub-u dešifruje".

   **Komande da to uradiš sam** (traje par minuta):
   ```bash
   # 1. uzmi poslednju kopiju iz privatnog repoa
   git clone --depth 1 https://github.com/Zlotvor92/zakazi-backup.git
   cd zakazi-backup/dnevno && ls -la | tail -5

   # 2. dešifruj (traži tvoj privatni ključ)
   age --decrypt -i ~/putanja/do/age-kljuca.txt \
       -o dump.sql.gz zakazi-2026-08-20.sql.gz.age
   gzip -dc dump.sql.gz > dump.sql && wc -c dump.sql

   # 3. vrati u prazan Postgres — SA proširenjem, što posao trenutno ne radi
   docker run -d --name proba -e POSTGRES_PASSWORD=proba postgres:17-alpine
   sleep 10
   docker exec proba psql -U postgres -d postgres -c \
     'create extension if not exists btree_gist;'
   docker exec -i proba psql -U postgres -d postgres -v ON_ERROR_STOP=0 < dump.sql 2> greske.txt

   # 4. ono što je ovde bitno — da li se ograničenja stvarno vrate
   docker exec proba psql -U postgres -d postgres -c \
     "select conname from pg_constraint where contype='x';"
   #    OČEKUJ: appointments_no_overlap i working_hours_no_overlap
   #    Bez koraka 3 ovaj spisak je PRAZAN — to je nalaz O1.
   docker exec proba psql -U postgres -d postgres -c "select count(*) from pg_policy;"
   docker rm -f proba
   ```
   Pošalji mi izlaz koraka 4 i zatvaram O1 kao potvrđen ili oboren nad pravim fajlom.

2. **Sadržaj repoa `Zlotvor92/zakazi-backup`.** Pokušao sam da ga dodam u sesiju; zahtev
   je odbijen (repo nije u opsegu ove sesije). Zato **nisam prebrojao fajlove u
   `dnevno/`** niti uporedio njihov broj sa brojem uspešnih prolaza. Iz dnevnika posla
   znam samo da je poslednji upis prošao (`Kopija zakazi-2026-08-20.sql.gz.age`).

3. **Sadržaj R2 kante.** Nemam pristup Cloudflare nalogu. Znam da je korak izvršen i
   uspeo (`upload: … to s3://***/…`), ali nisam video fajl sa druge strane niti proverio
   politiku zadržavanja.

4. **Broj prolaza posla za kopiju je premali za ocenu.** Zatraženo je „poslednjih 30
   prolaza"; postoji ih **6 ukupno**, i samo **jedan** zakazan:
   ```
   2026-08-20 02:31  success    schedule            #6   ← jedini zakazani
   2026-08-19 08:10  success    workflow_dispatch   #5
   2026-08-19 07:20  success    workflow_dispatch   #4
   2026-08-19 06:56  success    workflow_dispatch   #3
   2026-08-19 06:54  failure    workflow_dispatch   #2
   2026-08-19 06:41  cancelled  workflow_dispatch   #1
   ```
   Posao je star dva dana. „Ima li rupa od više dana" se ne može odgovoriti — nema još
   istorije. Vredi pogledati ponovo za dve nedelje.

5. **Zaštita grane `main`, detaljno.** API je vratio `403 Resource not accessible by
   integration` (token nema admin opseg). Zaključak u O6 se oslanja na
   `"protected": false` iz spiska grana i prazan spisak `rulesets` — to je dovoljno da se
   tvrdi da zaštite nema, ali nisam video ekran sa podešavanjima.

6. **GitHub secret scanning.** Put ka tom API-ju je blokiran kroz posrednika
   (`Access to this GitHub API path is not permitted through this proxy`). Pretragu
   istorije sam uradio sam, ručno, po obrascima (vidi O6) — ali GitHub-ov sopstveni
   skener nije pokrenut.

7. **Obaveštenja na uređaju (push).** Lokalni stek nema VAPID ključeve, pa ni tok
   uključivanja ni samo slanje nisu prošli kroz pregledač. Nije provereno ni ponašanje
   „bez VAPID ključa — poruka umesto slomljenog dugmeta".

8. **Prijava preko Google naloga.** Lokalno isključena (`NEXT_PUBLIC_GOOGLE_SIGN_IN=false`,
   i mejl provajder pao na S9), a u produkciji je nisam dirao jer bi to napravilo sesiju
   nad pravim podacima. Proverio sam samo da je uključena u podešavanjima
   (`external_google_enabled: True`) i da greška provajdera daje urednu poruku.

9. **Spora mreža i rad bez mreže.** Nisam prigušivao na 3G. Ponašanje pri **potpunom**
   otkazu baze jesam izmerio (O5) i tamo je nalaz jasan; „dugme zauvek u Šaljem…" pri
   sporoj-ali-živoj mreži nije provereno.

10. **Tastatura na pravom telefonu.** Emulacija na 390×844 ne otvara pravu tastaturu.
    Kod za to postoji i izgleda tačno (`revealSubmit()` sa 300 ms odlaganja i
    `scrollIntoView`, uz komentar koji opisuje baš taj problem na 375×812), ali nije
    potvrđeno na uređaju.

11. **SMTP blok u Supabase-u.** Pročitao sam ga (Resend, `smtp.resend.com`, korisnik
    `resend`, pošiljalac `prijava@doterajme.rs`, lozinka postavljena) i **ništa nisam
    dirao**, kako `docs/resend-smtp.md` izričito traži — delimičan `PATCH` briše lozinku.
    Da li poruke stvarno stižu do pravih sandučića nisam mogao da proverim bez slanja.

12. **Poređenje prava `anon` u produkciji sa lokalnim.** Tražilo je izvršavanje upita nad
    produkcijskom bazom. Umesto toga sam uporedio ono što Security Advisor prijavljuje sa
    lokalnim stanjem — spisak `security definer` funkcija dostupnih `anon`-u je **isti** u
    oba (7 aplikacijskih), pa nema znaka da je neko nešto menjao ručno. Produkcija još
    nema `p_staff_id` u `public_book`, što je očekivano — ta migracija je na ovoj grani,
    nije u `main`.

---

## Šta ostaje tebi — i tačno kako

Četiri stvari ne mogu da uradim umesto tebe. Za svaku stoji šta tačno treba.

### 1. Supabase je na besplatnom planu (O3) — jedina prava odluka

Ovo je jedina preostala stavka koja bih rekao da stvarno stoji na putu prodaji.
`pitr_enabled: false`, `backups: []`, `plan: "free"` — kod provajdera ne postoji nijedna
kopija koju možeš da vratiš. Jedina koja postoji je noćni posao na GitHub-u, dakle
gubitak **do 24 sata**.

- **Supabase Pro, 25 $/mesečno** — dnevne kopije kod provajdera i, važnije, projekat se
  više ne pauzira zbog neaktivnosti. Ovo bih uzeo pre prvog plaćenog korisnika.
- **PITR, dodatnih 100 $/mesečno** — gubitak pada sa sati na minute. Ovo ne bih uzimao dok
  ne budeš imao desetak salona koji plaćaju.
- **Besplatno, odmah:** u `.github/workflows/backup.yml` promeni `cron: "20 1 * * *"` u
  `cron: "20 1,13 * * *"`. Gubitak pada sa 24 na 12 sati, bez ijednog dinara.

### 2. Zaštita grane `main` (O6)

Moj token je dobio `403 Resource not accessible by integration` — traži admin prava.
Na GitHub-u: **Settings → Rules → New ruleset**, meta `main`, uključi „Require a pull
request before merging" i „Require status checks to pass" pa izaberi poslove `Provere` i
`Baza`. Sam sebi i dalje odobravaš PR, ali migracija više ne može da sklizne na
produkcijsku bazu mimo zelenog CI-ja — a Supabase je primenjuje sam, u roku od pola minuta.

### 3. DMARC na `quarantine` (S13)

SPF i DKIM su ispravni; ostaje samo pooštravanje. Kad dve nedelje izveštaji na
`zakazii.rs@gmail.com` budu čisti, promeni TXT zapis na `_dmarc.doterajme.rs`:

```
v=DMARC1; p=quarantine; pct=25; rua=mailto:zakazii.rs@gmail.com
```

pa posle nedelju dana `pct=100`. Postepeno, da legitimna pošta ne počne da pada u spam.

### 4. Dozvoljene adrese za prijavu u Supabase-u

Ovo **namerno nisam dirao**, i mislim da je to ispravno: tvoj `docs/resend-smtp.md`
izričito upozorava da se SMTP blok menja kao celina i da delimičan `PATCH` briše lozinku
i obara slanje pošte. Rizik da ti oborim prijavu u produkciji je veći od koristi.

U Supabase konzoli → **Authentication → URL Configuration** izbaci tri stavke:

```
https://zakazi-zlotvor93.vercel.app/**
https://zakazi-*-zlotvor93.vercel.app
https://zakazi-*-zlotvor93.vercel.app/**
```

Sad kad je preview zaključan iza Vercel prijave, aplikacijska prijava mu ne treba.

### Dve stvari koje sam svesno ostavio kako jesu

- **Produkcijski ključevi u `preview` okruženju.** Prvobitna preporuka je bila da se
  sklone, ali uslov pod kojim je pisana („ako preview nije zaštićen") više ne važi —
  preview sada traži Vercel prijavu. Sklanjanje ključeva bi ti oborilo sopstveno testiranje
  na preview-u, a dobitak je sada mali. Ako ipak želiš, jedna komanda po ključu:
  `PATCH /v10/projects/{id}/env/{envId}` sa `{"target":["production"]}`.
- **Mrežna ograničenja baze (O7).** Sužavanje na opsege GitHub Actions runnera zvuči dobro
  dok se ti opsezi ne promene — a onda noćna kopija tiho prestane da radi, što je gore od
  problema koji rešava. Ako hoćeš da se zatvori, bolji redosled je prvo premestiti kopiju
  na fiksnu adresu, pa tek onda zatvoriti bazu.

---

## Tri broja

Jedinica je „funkcija ili ponašanje" — jedna stavka sa spiska iz zadatka, ili jedna
provera koja se može zasebno ponoviti i dokazati.

| | pri reviziji | posle popravki |
|---|---|---|
| **Provereno funkcija i ponašanja** | 124 | 124 |
| **Radi kako treba** | 100 | **117** |
| **Ne radi ili odstupa** | 24 | **7** |

Od 24 prvobitna nalaza: **15 popravljeno i provereno**, **1 je bio moja greška u merenju**
(S1, ispravljen gore), **4 traže tvoju odluku** (O3, O6, O7, S13), **4 su kozmetika ili
tvoja odluka o proizvodu** (S7 `btree_gist` u `public`, S10 pauziran salon i otkazivanje,
S11 brojevi u `.ics`, S12 `npm audit`).

Raspodela onoga što je ostalo: **0 kritičnih**, **3 ozbiljna** (svi traže tvoju odluku),
**4 sitna**.

**Sam tok zakazivanja — izbor usluge, izbor izvođača, dan, sat, ime, telefon, potvrda —
nije imao nijednu zamerku ni pre popravki.** To je i mesto koje sam proverio najtemeljnije.

*Snimci ekrana: `qa/screenshots/` — 49 fajlova, 390×844 sa `deviceScaleFactor: 3`.
Skripte kojima je sve odrađeno: `qa/*.mjs`, da se svaki nalaz može ponoviti.*
