# DoterajMe Full Technical Audit

Commit revizije: `6c52330` (main, PR #52). Grana sa dokazima: `audit/full-audit`.
Datum: 2026-09-29. Produkcioni kod NIJE menjan; dodat je samo `tests/audit/` i ovaj fajl.

## Kako je rađeno i šta to znači za pouzdanost nalaza

- Stvarno pokrenuto: `typecheck`, `lint`, 206 unit testova, 388 DB testova (sve zeleno pre revizije), `next build`, `next start`, `npm audit`, Playwright/Chromium na 5 mobilnih viewporta, EXPLAIN nad 30.000 termina.
- DB je **PostgreSQL 16** iz kontejnera (CI i produkcija su 17). Migracije se primenjuju istim `globalSetup` kao u CI. Konačno stanje funkcija je čitano iz `pg_proc`, ne iz starih migracija.
- **Supabase (PostgREST, Kong, GoTrue) NIJE pokretan.** Za HTTP testove sam napisao mali PostgREST-zamenik (RPC → SQL kao rola `anon`). Sve što zavisi od stvarnog GoTrue-a, PostgREST-a ili Vercel-a je označeno `NEEDS VERIFICATION`.
- Nalazi označeni **CONFIRMED** imaju test koji ih reprodukuje (`tests/audit/`), ili je dokaz naveden uz nalaz.

---

## Executive Summary

Osnova je dobra: RLS je uključen na svih 17 tabela, anon nema pristup nijednoj tabeli, svaka `SECURITY DEFINER` funkcija ima zakucan `search_path`, dvostruko zakazivanje **ne može** da prođe ni pod pravom paralelnom trkom, a JS i SQL se slažu o slobodnim terminima na svim testiranim slučajevima (DST u oba smera, podeljena smena, odsustvo).

Problemi nisu u booking engine-u nego **oko njega**:

1. **Zaštita od zloupotrebe se zaobilazi jednim parametrom.** `p_network_hash` bira pozivalac, a anon ključ je javan. Poziv direktno na PostgREST zaobilazi limit po mreži za zakazivanje i za pogađanje tuđih brojeva (27/27 i 30/30 zahteva prošlo; limiti su 8 i 20).
2. **Izgubljen odgovor = lažna poruka.** Ako mreža padne posle uspešnog upisa, ekran kaže „ništa nije sačuvano", a ponovni pokušaj daje „sačekaj pola minuta", pa posle „neko je uzeo termin" — za termin koji je klijentkinjin. Nema idempotentnosti. Reprodukovano u pravom pregledaču.
3. **Limit po broju telefona pada pod paralelnim zahtevima** (9–10 od 10 prošlo, limit je 2).
4. **Anon može da napuni bazu preko `log_error`** (~480.000 znakova u minuti) i istovremeno ugasi evidenciju pravih grešaka.
5. **`next@15.5.23` ima „critical" advisory**; CI ga prikazuje ali ne zaustavlja.
6. Audit log (pravilo 4 iz CLAUDE.md) vlasnica može da falsifikuje (upiše događaj „otkazala klijentkinja") i da obriše brisanjem termina.

**Buffer:** ne postoji bug koji si sumnjao. `services.buffer_after_min` je namerno uklonjena migracijom `20260816290000` i zamenjena razmakom termina po bloku (`working_hours.slot_minutes`). `availability.ts` je zato tačan u odnosu na stvarni model. Ali CLAUDE.md i dalje opisuje buffer na usluzi, a proizvod trenutno **ne može** da napravi „60 min + 15 min buffer". Vidi F-16.

Nije nađeno ništa što curi podatke između salona (tenanta). Nije nađen open redirect. Cron je ispravno zaštićen.

---

## Critical Findings

Nema potvrđenih CRITICAL nalaza. Najbliži: F-04 (advisory je „critical", ali eksploatabilnost za ovu aplikaciju nije dokazana; vidi nalaz).

---

## High Priority

### F-01

ID: F-01
SEVERITY: HIGH
STATUS: CONFIRMED
CATEGORY: Abuse / rate limiting
TITLE: Limit po mreži se zaobilazi jer `p_network_hash` bira pozivalac
PROBLEM: `effective_network_hash()` vraća `p_client_hash` ako je poslat, i tek ako nije koristi `x-real-ip` koji postavlja Kong. `public_book`, `public_cancel_appointment` i `public_appointments_for_phone` su izvršive za `anon`, a `NEXT_PUBLIC_SUPABASE_ANON_KEY` je u javnom JS-u. Napadač zove PostgREST direktno i šalje drugačiji hash u svakom pozivu. Isto važi za `p_device_id` (limit po uređaju i „too_fast" cooldown od 30 s).
AFFECTED FILES: `supabase/migrations/20260818010000_edge_derived_network_hash.sql` (`effective_network_hash`), `20260927010000_limit_exempt_phones.sql` (`booking_limit_reason`, `phone_lookup_limit_reason`), `20260927000000_service_not_after.sql` (`public_book`), `lib/db/public-booking.ts`, `lib/network.ts`
AFFECTED CODE: `if p_client_hash is not null and p_client_hash <> '' then return p_client_hash; end if;`
WHY IT MATTERS: Bot sa jednim skriptom popuni ceo kalendar solo salona lažnim terminima (svaki poziv drugi broj + drugi hash). Ograničenja po broju ne pomažu jer je broj nov u svakom pozivu. Isti bypass omogućava pogađanje tuđih brojeva na `/otkazi` i otkazivanje tuđih termina (samo broj telefona je „dokaz", što je odluka iz migracije `20260818020000`, ali je bila zaštićena limitom koji ovde ne važi).
REPRODUCTION: `npx vitest run --config tests/audit/vitest.config.ts abuse` → testovi „pozivalac koji šalje svaki put drugi p_network_hash…" i „pogađanje tuđih brojeva…". Kontrola u istom fajlu dokazuje da limit RADI kad se hash ne šalje (osmi prolazi, deveti `too_many_from_network`).
EXPECTED: Najviše 8 zakazivanja/h i 20 pretraga/h po stvarnoj adresi, bez obzira na argumente.
ACTUAL: 27 od 27 zakazivanja prošlo (ostalih 3 od 30 je van radnog vremena); 30 od 30 pretraga vratilo termin.
ROOT CAUSE: Poverenje u vrednost koju kontroliše nepoverljiv pozivalac. Hash mora da računa server, ali je jedini način da ga baza dobije parametar, a parametar može da pošalje bilo ko.
RECOMMENDED FIX: Pozivati `public_book`, `public_cancel_appointment`, `public_appointments_for_phone` sa `service_role` klijentom iz server akcije (`createAdminClient()` već postoji), a `anon`-u oduzeti `execute` na ove tri funkcije. `public_booking_data` i `public_salon_summary` ostaju javne. Tada je `p_network_hash` uvek serverski izračunat.
MINIMAL FIX: Ista stvar, samo za `public_book` prvo. Ne dodavati novi sistem.
OPTIONAL BETTER FIX: Rate limit na ivici (Vercel Firewall) uz DB limit kao drugu liniju.
TEST THAT SHOULD BE ADDED: Postojeći `tests/audit/db/abuse.repro.ts` (posle fix-a `anon` poziv mora da padne sa `permission denied`; `tests/db/anon-surface.test.ts` se menja u skladu s tim).
Napomena: `x-forwarded-for` u `lib/network.ts` je bezbedan samo dok je aplikacija na Vercel-u (Vercel prepisuje zaglavlje) — NEEDS VERIFICATION.

### F-02

ID: F-02
SEVERITY: HIGH
STATUS: CONFIRMED (E2E u Chromium-u, Pixel 7)
CATEGORY: Idempotency / mobile reliability
TITLE: MISSING IDEMPOTENCY — izgubljen odgovor ostavlja termin u bazi, a ekran tvrdi „ništa nije sačuvano"
PROBLEM: Nema idempotency ključa ni zahteva sa UUID-om. Kad odgovor server akcije stigne prekinut, `booking-flow.tsx` prikazuje `sr.error.unreachable` = „Nije uspelo — ništa nije sačuvano". Komentar u `sr.ts` (linija ~86) to pravda tvrdnjom „bitno je samo da ništa nije upisano", što je pogrešna pretpostavka. Ponovni pritisak: `too_fast` („Sačekaj pola minuta"), a posle 30 s `slot_taken` („Neko je upravo uzeo taj termin") — za termin koji je njen.
AFFECTED FILES: `app/(public)/[tenantSlug]/booking-flow.tsx:169-190`, `app/(public)/[tenantSlug]/actions.ts`, `lib/i18n/sr.ts:86-91`, `supabase/migrations/20260927000000_service_not_after.sql` (`public_book`)
AFFECTED CODE: `catch { setState({ status: "error", message: sr.error.unreachable }); }`
WHY IT MATTERS: Ovo je glavni tok na telefonu u lošem signalu. Klijentkinja misli da nema termina, bira drugi (troši limit „2 nedeljno") ili odustaje; salon ima termin za osobu koja neće doći.
REPRODUCTION: `AUDIT_SLUG=studio-milica npx playwright test -c tests/audit/playwright.config.ts` (zahtev stiže do servera, odgovor se prekida). Baza: `tests/audit/db/concurrency.repro.ts` → „isti zahtev poslat dvaput…" daje `too_fast`.
EXPECTED: Isti zahtev poslat dvaput vraća isti termin (`ok: true`, isti `id`), ili ekran ne tvrdi da ništa nije sačuvano.
ACTUAL: Drugi odgovor `ok:false, reason:'too_fast'`. **Drugi termin se NE pravi** (potvrđeno: 3 istovremena identična zahteva → tačno 1 red), ali korisnik to ne zna.
ROOT CAUSE: Provera duplikata je samo ograničenje preklapanja; ono odbija drugi upis, ali ga prijavljuje kao grešku, a ne kao „već zakazano".
RECOMMENDED FIX: U `public_book`, PRE `booking_limit_reason`, potraži postojeći `confirmed` termin sa istim `phone_e164`, `service_id`, `start_at`, `source='public'` kreiran u poslednjih ~10 min i vrati ga kao `ok:true` sa istim `id` (prirodni ključ, bez novog stupca). Uz to promeniti tekst `unreachable` tako da ne tvrdi da ništa nije sačuvano ("Veza je pukla. Proveri da li je termin zakazan pre nego što pokušaš ponovo" ili automatski ponovi isti zahtev jednom).
MINIMAL FIX: Samo promena teksta (jedna linija u `sr.ts`). Ne rešava ponovni pokušaj.
OPTIONAL BETTER FIX: UUID zahteva generisan u pregledaču (skriveno polje) + kolona `request_id uuid unique` na `appointments`. Složenije, a prirodni ključ pokriva isti slučaj.
TEST THAT SHOULD BE ADDED: `tests/audit/db/concurrency.repro.ts` i `tests/audit/e2e/lost-response.repro.ts` (već napisani, padaju).

### F-03

ID: F-03
SEVERITY: HIGH
STATUS: CONFIRMED (aritmetika i test); NEEDS VERIFICATION (plan/limit skladišta)
CATEGORY: Error logging / DoS
TITLE: Anon može da napuni bazu i ugasi evidenciju grešaka preko `log_error`
PROBLEM: `log_error` je izvršiv za `anon`, dozvoljava 60 upisa/min ukupno (jedna deljena kofa za client i server), do 8.000 znakova stack-a + 500 poruke + 300 putanje + 300 UA po redu. Retencija je 30 dana.
AFFECTED FILES: `supabase/migrations/20260819030000_error_events.sql:50-90`, `app/api/greske/route.ts`, `lib/db/errors.ts`
WHY IT MATTERS: (a) 60 × ~8 KB ≈ 480 KB/min ≈ 690 MB/dan sirovo. Na Supabase Free (500 MB) baza za manje od dana postaje read-only za CEO proizvod; (b) dok napadač drži kofu punom, prava greška servera se tiho odbacuje — test: 60 anon redova, pa jedna prava greška → **prava nije upisana**.
REPRODUCTION: `tests/audit/db/abuse.repro.ts` → „anonimna poplava…" (poruka u assertion-u: 480470 znakova u 60 redova, prava greška 0).
EXPECTED: Anonimna poplava ne sme ni da ugrozi skladište ni da istisne greške servera.
ACTUAL: Oba se dešavaju.
ROOT CAUSE: Jedna kofa bez razdvajanja izvora i bez ograničenja ukupne veličine.
RECOMMENDED FIX: Odvojiti kofe: `source='client'` najviše 10/min i `stack` do 2.000 znakova; `source='server'` ima svoju kofu (poziva ga samo server, može kroz `service_role`). Retencija sa 30 na 7 dana.
MINIMAL FIX: Dve linije u `log_error`: brojati po `source`, seći `stack` na 2000.
TEST THAT SHOULD BE ADDED: Postojeći repro + test da 10 client grešaka/min ne blokira server grešku.
Privatnost: vidi „Error Logging / Privacy".

### F-04

ID: F-04
SEVERITY: HIGH
STATUS: CONFIRMED (verzija je ranjiva); NEEDS VERIFICATION (eksploatabilnost)
CATEGORY: Dependencies / CI
TITLE: `next@15.5.23` — 1 critical, 3 high, 2 moderate u `npm audit`; CI ne staje
PROBLEM: `npm audit`: `next` (critical, 2 advisory-ja, fiksirano u 15.5.24+), `postcss`, `sharp` (preko next-a), `js-yaml`, `vitest`/`@vitest/mocker`. `package.json` fiksira `"next": "15.5.23"` (bez `^`), pa `npm audit fix` to ne dira. CI posao `audit` ima `continue-on-error: true` (`ci.yml:169`).
WHY IT MATTERS: Advisory „RCE u Image Optimization API kada se koriste AVIF fajlovi" (GHSA-2xp9-vwfh-vxw4) i „RCE na Windows-hosted serverima" (GHSA-p293-qw3h-jr36). Aplikacija je na Linux Vercel-u i ne koristi `next/image` (koristi `<img>`), bez `remotePatterns`. Verovatno nije eksploatabilno, ali to NISAM dokazao.
RECOMMENDED FIX / MINIMAL FIX: `next` i `eslint-config-next` na `15.5.26` (npm ga označava kao ne-major, `fixAvailable`); `npm audit fix` za `vitest` i `js-yaml`.
OPTIONAL BETTER FIX: `npm audit --omit=dev --audit-level=critical` kao blokirajući korak (dev zavisnosti ne idu u produkciju).
TEST THAT SHOULD BE ADDED: Nije potreban test; CI korak iznad.

---

## Medium Priority

### F-05

ID: F-05
SEVERITY: MEDIUM
STATUS: CONFIRMED
CATEGORY: Concurrency / abuse
TITLE: Limit po broju telefona (2 nedeljno, 4 buduća) pada pod paralelnim zahtevima
PROBLEM: `booking_limit_reason` je `STABLE` i broji ranije upisane termine; između brojanja i `insert`-a nema zaključavanja. Paralelni zahtevi u READ COMMITTED ne vide jedni druge.
AFFECTED FILES: `20260927010000_limit_exempt_phones.sql` (`booking_limit_reason`), `public_book`
WHY IT MATTERS: Jedan broj sa 10 istovremenih zahteva zauzme 9–10 termina (limit 2). Sam limit je poslednja linija za slučaj F-01.
REPRODUCTION: `tests/audit/db/concurrency.repro.ts` → „isti broj sa 10 istovremenih zahteva…": očekivano ≤ 2, dobijeno 9 i 10 (dva pokretanja).
EXPECTED: ≤ 2. ACTUAL: 9–10.
ROOT CAUSE: Provera-pa-upis bez serijalizacije po broju.
MINIMAL FIX: U `public_book`, odmah pre `booking_limit_reason`: `perform pg_advisory_xact_lock(hashtextextended(v_tenant.id::text || ':' || p_phone_e164, 0));` — serijalizuje zahteve istog broja u istom salonu, ne dira ostale.
TEST THAT SHOULD BE ADDED: Isti repro (posle fix-a mora da prođe).
Napomena: dvostruko zakazivanje **istog termina** ovo ne pogađa; njega drži ograničenje (vidi „Verified Safe").

### F-06

ID: F-06
SEVERITY: MEDIUM
STATUS: CONFIRMED
CATEGORY: Audit log integrity (CLAUDE.md pravilo 4)
TITLE: Vlasnica može da upiše lažan događaj i da obriše istoriju brisanjem termina
PROBLEM: (1) Politika `appointment_events_insert` dozvoljava svakom članu da upiše red sa proizvoljnim `actor_type`/`to_status`. Test: `insert … 'confirmed' → 'cancelled_by_client', actor 'client'` prolazi. (2) `appointments_delete` je dozvoljen članovima, a `appointment_events` ima `ON DELETE CASCADE` — brisanje termina briše i dokaz. UI nigde ne briše termine (proveren grep), ali direktan PostgREST poziv može.
AFFECTED FILES: `supabase/migrations/20260816160000_rls.sql:107-118`, `20260816150000_init.sql` (FK), `20260816180000_appointment_audit.sql` (trigger je `SECURITY DEFINER`)
WHY IT MATTERS: Cilj loga je dokaz u sporu „ja to nisam otkazala". Stranka sa motivom da ga menja je upravo salon. Trenutno log dokazuje samo da salon nije lagao sam sebi.
REPRODUCTION: `tests/audit/db/abuse.repro.ts` → „vlasnica salona ne sme da upiše događaj…" i „vlasnica koja obriše termin…".
EXPECTED: Događaje piše samo trigger; brisanje termina ne briše istoriju.
ACTUAL: Oba prolaze.
ROOT CAUSE: INSERT politika je ostala iz prve migracije, pre triger-a. Komentar u `appointment_audit.sql:17` kaže da trag mora da nastane „i kad politika ne bi pustila" — dakle triger je već nezavisan od politike.
MINIMAL FIX: `drop policy appointment_events_insert` i `revoke delete on appointments from authenticated` (otkazivanje ide statusom). Postojeći test `rls.test.ts` „dozvoljava upis novog reda u sopstvenom salonu" namerno tvrdi suprotno — to je odluka koju treba da potvrdiš.
OPTIONAL BETTER FIX: FK sa `ON DELETE RESTRICT` umesto `CASCADE`.
TEST THAT SHOULD BE ADDED: Repro testovi iznad.

### F-07

ID: F-07
SEVERITY: MEDIUM
STATUS: CONFIRMED
CATEGORY: Phone normalization / blocklist
TITLE: Blokiran broj se zaobilazi upisom `+381` + `0` + broj (isti telefon, drugi string)
PROBLEM: SQL regex `^\+381[0-9]{8,9}$` (u `public_book`, cancel, lookup, `clients_phone_e164_format`, `limit_exempt_phones`) dozvoljava vodeću nulu posle koda zemlje. `+38164123456` i `+381064123456` su dva različita stringa: blocklist, limiti po broju i `clients` ih tretiraju kao različite osobe. UI ne može to da pošalje (`normalizePhone` skida nulu); direktan RPC može.
WHY IT MATTERS: Blocklist služi baš onima koji hoće da zloupotrebe. Uz F-01 neograničen broj varijanti po stvarnom broju.
REPRODUCTION: `tests/audit/db/abuse.repro.ts` → „blokiran broj ne zaobilazi se…": kanonski `blocked`, varijanta `ok:true`.
MINIMAL FIX: Regex u svim mestima `^\+381[1-9][0-9]{7,8}$` (i u check ograničenjima; postojeći redovi ne sadrže vodeću nulu jer UI ne šalje — proveriti upitom pre migracije).
TEST THAT SHOULD BE ADDED: Repro iznad.

### F-08

ID: F-08
SEVERITY: MEDIUM
STATUS: LIKELY (redosled u kodu je potvrđen; put eksploatacije nije pokrenut)
CATEGORY: Authorization
TITLE: `addSalon` pravi Auth nalog preko service_role PRE provere da li je pozivalac vlasnik platforme
PROBLEM: `app/(dashboard)/admin/actions.ts:68` zove `ensureUser(email)` (service_role, `email_confirm: true`), a tek posle toga `createSalon` koji baza odbija za ne-vlasnika. Middleware propušta svakog ulogovanog na `/admin`; stranica vraća 404, ali server akcija je posebna krajnja tačka.
WHY IT MATTERS: Ulogovana vlasnica salona (plaćeni korisnik) može da napravi potvrđene Auth naloge za proizvoljne mejlove. Nalog ne daje pristup salonu, ali zaobilazi „registracija je zatvorena" i puni `auth.users`.
NEEDS VERIFICATION: Da server akcija stvarno može da se pozove sa `/admin` rute pod običnom sesijom (traži Next-Action ID i pravi GoTrue).
MINIMAL FIX: `if (!(await isPlatformOwner())) return { status: "error", … }` na početku `addSalon` (isti obrazac već postoji u `saveLogo`, linija ~29 tog bloka).
TEST THAT SHOULD BE ADDED: Unit test akcije sa mock-ovanim `isPlatformOwner` → `ensureUser` se ne zove.

### F-09

ID: F-09
SEVERITY: MEDIUM
STATUS: CONFIRMED (kod); rast tabele NEEDS VERIFICATION u produkciji
CATEGORY: Database / retention
TITLE: `phone_lookup_attempts` se nikad ne čisti
PROBLEM: Svaki poziv `public_appointments_for_phone` i `public_cancel_appointment` upisuje red. `grep -rn "delete from phone_lookup" supabase lib app` — nema rezultata. Prozor koji se koristi je 60 min.
WHY IT MATTERS: Uz F-01 anon pravi neograničen broj redova; tabela i njen indeks rastu zauvek.
MINIMAL FIX: Na početku `phone_lookup_limit_reason` ili u samim funkcijama: `delete from phone_lookup_attempts where created_at < now() - interval '1 day'` (isti obrazac kao `log_error`). Indeks na `created_at` nije potreban dok je obim mali.
TEST THAT SHOULD BE ADDED: Ubaciti red od pre 2 dana, pozvati funkciju, očekivati da ga nema.

---

## Low Priority

### F-10 — Početak termina sa razlomkom sekunde se prihvata
SEVERITY: LOW | STATUS: CONFIRMED | CATEGORY: Server-side validation
PROBLEM: `is_bookable_start` poredi `extract(epoch from …)::bigint % (slot*60) = 0`; `::bigint` zaokružuje. `09:00:00.4` prolazi. Termin se čuva sa pomerajem 0,4 s i susedni `10:00:00` postaje `slot_taken`. UI šalje cele sekunde (Zod `z.iso.datetime` ipak dozvoljava razlomak), pa je dostupno samo direktnim RPC-om.
REPRODUCTION: `tests/audit/db/misc.repro.ts` → „početak sa razlomkom sekunde": `skewedAccepted: true`, `neighbourAccepted: false (slot_taken)`.
MINIMAL FIX: u `is_bookable_start` dodati `and date_trunc('minute', p_start_at) = p_start_at`.
AFFECTED FILES: `20260919030000_salon_chooses_overrun.sql` (`is_bookable_start`, linija 70)

### F-11 — Vlasnica može da upiše proizvoljan push `endpoint`
SEVERITY: LOW | STATUS: CONFIRMED (upis); efekat NEEDS VERIFICATION
PROBLEM: `push_subscriptions.endpoint` nema ograničenje osim `unique`; Zod proverava samo `z.url()` u aplikaciji. Direktan upis `https://attacker.example.test/collect` prolazi. Pri svakom zakazivanju server (`lib/messaging/push.ts`) šalje `web-push` POST na taj URL: slepi SSRF sa Vercel funkcije. Verovatno ne dosegne interne servise, ali napadač dobija server-side zahtev na proizvoljan https host. `web-push` verovatno odbija `http://`, nisam proveravao.
REPRODUCTION: `tests/audit/db/misc.repro.ts` → „push_subscriptions.endpoint".
MINIMAL FIX: `check (endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/')` (proveriti listu prema pretplatama u produkciji).

### F-12 — Odjava gasi sesiju na svim uređajima
SEVERITY: LOW | STATUS: CONFIRMED (u kodu biblioteke)
`supabase.auth.signOut()` bez argumenta koristi `scope: 'global'` (`@supabase/auth-js`, `GoTrueClient.ts:4043`). Odjava na telefonu odjavljuje i laptop. Fix: `signOut({ scope: 'local' })` (`app/(dashboard)/dashboard/actions.ts:25`).

### F-13 — `create_appointment` baca izuzetak za strani broj
SEVERITY: LOW | STATUS: CONFIRMED | Direktan RPC
Regex u funkciji je `^\+[1-9][0-9]{7,14}$`, a `clients` traži `+381…`. Rezultat: `check_violation` umesto `{ok:false, reason:'invalid_phone'}`. UI to ne može da izazove (`normalizePhone` odbija strane brojeve). Isto: komentar u `lib/domain/phone.ts:13` kaže da je `E164` „ista provera koju radi ograničenje `clients_phone_e164_format`", a to više nije tačno. REPRODUCTION: `tests/audit/db/misc.repro.ts`.

### F-14 — Nema sigurnosnih zaglavlja
SEVERITY: LOW | STATUS: CONFIRMED (`curl -D-` na `next start`) | NEEDS VERIFICATION na Vercel-u (HSTS on dodaje)
Nema `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`; šalje se `X-Powered-By: Next.js` (`poweredByHeader: false`). Javna strana za zakazivanje može da se ugradi u tuđ iframe (clickjacking). Fix: `headers()` u `next.config.ts` (`frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`). CSP sa `script-src` traži oprez zbog Next-a; početi sa `frame-ancestors`.

### F-15 — Mali UX/PWA nalazi
SEVERITY: LOW | STATUS: CONFIRMED
- Koraci (usluga → dan → vreme) ne dodaju ni jedan unos u istoriju: „Nazad" u pregledaču izlazi sa stranice i gubi izbor (izmereno: `history.length` se ne menja; Back sa koraka 2 vodi na prethodnu adresu).
- Nema offline stranice (`sw.js` nema `fetch` obrađivač; offline reload daje grešku pregledača). Da li Chrome na Androidu nudi instalaciju bez `fetch` obrađivača — NEEDS VERIFICATION.
- Dugme „Promeni" je 78×41 px (< 44 px), na svih 5 viewporta.
- `manifest`: `start_url: /dashboard`, bez `id` i `scope`; `theme_color` (#4d213c) se razlikuje od `themeColor` javne strane (#FBF7F0) — namerno, ne menjati.

### F-18 — Token kalendara u putanji završava u `error_events`
SEVERITY: LOW | STATUS: LIKELY
`instrumentation.ts` upisuje `request.path` za greške servera; putanja `/api/kalendar/salon/<token>.ics` nosi token koji otvara imena i telefone svih klijenata salona. Čita ga samo vlasnik platforme, ali token ne sme u log. Fix: u `instrumentation.ts` zameniti segment posle `/api/kalendar/salon/` sa `[token]`.

---

## Verified Safe

Svaka stavka ima dokaz. „Test" = `tests/audit/db/*.verified.ts` ili postojeći test.

| Šta | Dokaz |
|---|---|
| Dvostruko zakazivanje istog termina | 12 paralelnih konekcija, svaka svoja transakcija: tačno 1 pobednik, 11 × `slot_taken`, 1 red u `appointments` (`concurrency.repro.ts`, prvi test prolazi) |
| Nema delimičnog stanja posle izgubljene trke | 8 paralelnih: 1 termin, 1 događaj, 1 klijent (gubitnički `insert into clients` se vraća zajedno sa potransakcijom) |
| Ponovljeni identični zahtevi ne prave dupli termin | 3 istovremena identična zahteva → tačno 1 red |
| RLS uključen na svih 17 tabela | `pg_class.relrowsecurity` |
| Anon ne čita nijednu tabelu | petlja po `pg_tables` kao `anon`: svaki `select` pada (`rls.verified.ts`) |
| Anon-izvršive funkcije | `pg_proc` + `has_function_privilege`: samo `public_book`, `public_booking_data`, `public_appointments_for_phone`, `public_cancel_appointment`, `public_salon_summary`, `calendar_feed`, `log_error` (+ nebitni `add_minutes`, `set_updated_at`) |
| `public_booking_data` ne vraća podatke o klijentu | `+381`, ime klijenta i reč `client` ne postoje u odgovoru |
| Svaka `SECURITY DEFINER` funkcija ima `search_path` | 26/26 |
| A → B upis: `tenant_id`, `staff_id`, `service_id`, `client_id` na INSERT i UPDATE | RLS + složeni strani ključevi `(tenant_id, x_id)`; 6 pokušaja odbijeno (`rls.verified.ts`) |
| A → B UPDATE/DELETE tuđeg termina | `rowCount = 0` |
| A ne može da se učlani u B, ni da upiše blocklist/error_events/push za B | odbijeno |
| Vlasnica ne može da menja `paid_until`, `suspended_at`, `plan`, `slug`, `calendar_token` | kolonski GRANT na `tenants`: samo 5 kolona (`booking_horizon_days`, `min_lead_minutes`, `public_booking_enabled`, `break_overrun_min`, `shift_overrun_min`) |
| JS (`buildAvailability`) i SQL (`is_bookable_start` + preklapanje + odsustvo) se slažu | svih 5-minutnih početaka u danu, 4 trajanja (30/60/90/150), 3 kombinacije tolerancije, oko obe promene sata (2026-10-23…26 i 2027-03-26…29), sa zauzetim terminom i odsustvom: 0 razlika (`parity.verified.ts`) |
| DST | Termin u 10:00 Europe/Belgrade ostaje 10:00 lokalno; `end_at` je tačan preko promene sata (postojeći test `constraints.test.ts`); blok 00:00–24:00 na dan prelaska na letnje vreme: JS = SQL |
| Podeljena smena 09–13 / 16–20 | 13:00–16:00 se nikad ne nudi; tačna lista početaka: 09,10,11,12,16,17,18,19 |
| Odsustvo (pre/posle/preklapanje/obuhvata) | u paritetu, plus postojeći `time-off.test.ts` |
| Bufer na `appointments` (ako je > 0) radi | `blocked_range` = trajanje + bufer; 10:00–11:00 + 15 → 11:00 zauzeto, 11:15 slobodno u JS i SQL (ali ništa ne upisuje bufer > 0; vidi F-16) |
| Cron autorizacija | 401 bez zaglavlja, 401 sa pogrešnim, 401 za `bearer` malim slovom, 200 sa tačnim; poređenje je `timingSafeEqual`; bez `CRON_SECRET` `requireEnv` baca izuzetak (ne otvara se) |
| Cron idempotentnost | menja samo `confirmed` sa lokalnim datumom < današnji po tajmzoni salona; drugi poziv ne menja ništa; ako padne jedan dan, sledeći ga hvata (`<`, ne `=`) |
| Open redirect u `/auth/callback` | odredište je fiksno `/dashboard`; `next=`, `redirect_to=`, `error=&next=//evil` ne menjaju Location (curl) |
| Nepotpisan/nevažeći kod | `/prijava?greska=1` |
| Neulogovan → `/dashboard`, `/admin`, `/dashboard/podesavanja` | 307 na `/prijava`; `x-middleware-subrequest` zaglavlje ne zaobilazi (Next 15.5.23) |
| ICS injekcija | CRLF u `usluga` se izlazi kao `\n`; nema novog `BEGIN:VALARM` bloka |
| Nepostojeći token kalendara | vraća prazan kalendar sa 200, ne 404/500 |
| Performanse | 1 RPC po prikazu javne strane (`public_booking_data`), 1 po `/otkazi`; 2,8 ms uz 30.000 termina i 30.000 događaja; upit po uređaju 0,3 ms (plan ide preko delimičnog GiST indeksa) |
| Mobilni prikaz | 375×667, 390×844, 393×873, 430×932, 412×915: nema horizontalnog skrola, nema JS grešaka, dugme se onemogućava dok traje slanje (dvoklik ne šalje dvaput) |
| Build | `next build` prolazi; javna strana 176 kB First Load JS |
| Kvalitet koda | nema `any`, `@ts-ignore`, `TODO/FIXME`, `console.log`; 5 × `console.error` u auth kodu, poruke ne sadrže mejl |

---

## Booking Engine

Put: `page.tsx` → `getPublicBookingData` (1 RPC) → `BookingFlow` računa slobodne termine u pregledaču (`buildAvailability`) → `submitBooking` (Zod, `normalizePhone`, `deviceId`, `networkHash`) → RPC `public_book` → `appointments`.

Gde se šta računa:

- `start_at`: dolazi od klijenta (`startAt`), baza ga NE računa nego proverava (`is_bookable_start`).
- `duration_min`: uzima se iz `services.duration_min` u bazi (klijent ne šalje trajanje). ✔
- `end_at`: generisana kolona `add_minutes(start_at, duration_min)`.
- `blocked_range`: generisana kolona `[start_at, start_at + duration + buffer_after_min)`; nad njom stoji `EXCLUDE USING gist (staff_id =, blocked_range &&) WHERE status IN ('pending','confirmed')`.
- `buffer_after_min`: `public_book` i `create_appointment` upisuju literal `0`.

Server ponovo validira sve što frontend prikazuje: salon postoji/uključen/nije suspendovan/pretplata važi, ime (≤80), telefon, usluga pripada salonu i aktivna je i vezana za izvođača, pravilo prozora usluge, redosled usluga, horizont, `min_lead_minutes`, radno vreme + tolerancija, mreža koraka, odsustvo, blocklist, limiti. Frontend nije izvor istine. ✔

Zapažanja bez nalaza: javno zakazivanje je uvek za PRVOG aktivnog izvođača (`booking_staff_id`); `public_book` ne prima `staff_id` ni `tenant_id`, pa tuđe vrednosti ne mogu da se proslede (proverena potpisa funkcije). Prošlost je odbijena (`outside_window`), lead time (`too_soon`), onemogućena usluga (`unknown_service`), usluga drugog salona (`unknown_service`) — sve već pokriveno u `public-booking.test.ts`.

## Concurrency

Trka za isti termin je bezbedna (vidi „Verified Safe"). RLS na to ne utiče jer `public_book` je `SECURITY DEFINER`. Aplikacija hvata `exclusion_violation` u bloku `begin … exception … end` i vraća `{ok:false, reason:'slot_taken'}` sa porukom „Neko je upravo uzeo taj termin. Izaberi drugi." (`sr.ts:666`); to je kontrolisan rezultat. Ali ograničenje po broju telefona i ostali limiti NISU serijalizovani (F-05).

Ostaje mali prozor: odsustvo (`time_off`) upisano istovremeno sa `public_book` nije pod ograničenjem (u DB postoji samo za termine), pa termin i odsustvo mogu da se preklope. Vlasnica je već upozoravana na preklapanje (`overlapping` u `add_time_off`). Ne predlažem fix.

## Idempotency

MISSING IDEMPOTENCY — F-02. Zaštićeno je samo dvoklikom (onemogućeno dugme) i ograničenjem u bazi. Nema ključa zahteva i sistem ne zna da je zahtev B isti kao A.

## Buffer

Detaljan odgovor na pitanje iz zadatka:

- CONFIRMED: `availability.ts` ne prima `buffer_after_min`; ima samo `serviceMinutes`.
- CONFIRMED: usluga nema buffer. `20260816290000_slots_per_block.sql:29-30` radi `alter table services drop column duration_min, drop column buffer_after_min` (`duration_min` je kasnije vraćen u `20260816300000`). Komentar migracije: „Trajanje usluge time prestaje da postoji kao pojam: salon je napravio blok i zna šta u njega staje".
- Buffer je zamenjen: `working_hours.slot_minutes` je razmak na kom salon prima, a busy opseg u `public_booking_data` je `blocked_range` (koji i dalje sadrži `buffer_after_min` iz reda).
- Primer iz zadatka (60 min + 15 min buffer, 10:00–11:00): sledeći dolazak je 11:00 na mreži od 60; 11:15 samo ako je mreža 75 (10:00, 11:15, …). Test: `parity.verified.ts` → „public_book uvek upisuje buffer_after_min = 0…".
- Ako `appointments.buffer_after_min > 0` ipak postoji (npr. ručni upis), i JS i baza ga poštuju: 11:00 zauzeto, 11:15 slobodno (`parity.verified.ts`, poslednji test).
- Buffer preko pauze / druge smene / kraja radnog vremena: nema buffer-a, pa nema šta da se preliva; ponašanje pauze i kraja dana kontrolišu `break_overrun_min` i `shift_overrun_min` (tolerancija trajanja, ne buffer-a) i u paritetu su sa SQL-om.
- Buffer + odsustvo + DST: pokriveno paritetom (bufer 15 min, odsustvo, oba prelaska).

Zaključak: nije bug u kodu, nego razlika između CLAUDE.md i proizvoda. Odluka za tebe: da li salonu treba pravi buffer (F-16).

## Timezone / DST

Testirano: 2026-10-23…26 (povratak na zimsko, nedelja 25.10.) i 2027-03-26…29 (prelazak na letnje, nedelja 28.3.). JS računa preko datuma (`instantInTimeZone` sa `fromZonedTime`), SQL preko `(local_date + time) at time zone tz`; nema razlika u 4 trajanja × 3 tolerancije. Grep za `new Date()` u poslovnoj logici: samo `createdAt` u ICS-u, `currentDateInTimeZone(new Date(), tenant.timezone)` (eksplicitna tajmzona) i `logo.ts` ime fajla. ✔
Ograničenje: `public_book` odbija termine dalje od `booking_horizon_days` (max 90); 2027-03-28 je van horizonta od danas, pa je taj datum testiran na nivou `is_bookable_start` i JS-a, ne kroz `public_book`. Prava jednosatna praznina (02:00–03:00) nije relevantna jer nijedan salon ne radi tada, ali blok 00:00–24:00 je testiran.

## Working Hours

Podeljena smena, kraj smene, tolerancija, prelazak preko granice: paritet i postojeći testovi (`availability.test.ts`, `public-booking.test.ts`).

## Absences

Isto; plus `time-off.test.ts`. `add_time_off` ne blokira preklapanje sa zakazanim terminom nego ga broji (`overlapping`) — odluka proizvoda.

## Supabase / RLS

Mapa tenant-owned tabela (svih 17 sa RLS): `appointments`, `appointment_events`, `blocklist`, `clients`, `limit_exempt_phones`, `memberships`, `messages`, `phone_lookup_attempts`, `push_subscriptions`, `services`, `staff`, `staff_services`, `tenants`, `time_off`, `working_hours` + globalne `error_events`, `platform_owners`.

| Tabela | anon | vlasnik (S/I/U/D) | drugi tenant | napomena |
|---|---|---|---|---|
| appointments, clients, services, staff, staff_services, time_off, working_hours | ništa | sve | ništa | verifikovano |
| appointment_events | ništa | S, **I** (F-06) | ništa | nema U/D politike |
| blocklist | ništa | S/I/D | ništa | |
| memberships | ništa | S | ništa | nema I/U/D |
| tenants | ništa | S, U samo 5 kolona | ništa | |
| messages | ništa | S | ništa | piše service_role |
| push_subscriptions | ništa | po `user_id` | ništa | endpoint slobodan (F-11) |
| error_events, phone_lookup_attempts, limit_exempt_phones, platform_owners | ništa | ništa (nema politike) | — | samo kroz funkcije |

`TRUNCATE` grant za `authenticated` postoji na većini tabela (opšti `grant … on all tables`). PostgREST ne izlaže TRUNCATE, pa nije dostupno kroz API; INFO — može se ukloniti `revoke truncate` radi dubinske odbrane.

`service_role` zaobilazi RLS po dizajnu i koristi se samo iz servera (`push`, `logo`, `complete_past_appointments`, `prior_no_shows`, `ensureUser`).

## Public Booking Security

RPC potpisi ne primaju `tenant_id`/`staff_id`. `slug` je jedini ulaz za salon. Nevažeći `service_id` (tuđi salon, nepostojeći, neaktivan, nevezan za izvođača) → `unknown_service`. Nepoznat salon i ugašeno zakazivanje su nerazlučivi (`booking_closed`). Rate limit i blocklist: F-01, F-05, F-07.

## Auth

Verifikovano lokalno (bez GoTrue): zaštićene rute, callback bez open redirect-a, middleware bypass zaglavlje. NEEDS VERIFICATION (traži pravi Supabase): jednokratnost magic link tokena, istekla sesija, invalid token. `getClaims()` u middleware-u proverava potpis lokalno, pa opozvana sesija važi do isteka tokena (do sat vremena; komentar u kodu to priznaje). Google-prijava vezuje adresu sa nalogom. `siteOrigin()` gradi `emailRedirectTo` iz `Host` zaglavlja; zaštita je Supabase allow-lista redirect URL-ova — NEEDS VERIFICATION da je podešena striktno.

## Cron

Vidi „Verified Safe". Raspored `0 1 * * *` UTC (03:00 leti, 02:00 zimi po Beogradu): lokalni datum je već sledeći dan pa nije potrebna DST korekcija. Ako se izvrši dvaput: drugi put menja 0 redova. Ako padne: sledeći prolaz hvata sve starije termine.

## Error Logging / Privacy

- Ko piše: `anon` (F-03). Ko čita: samo `platform_owners` kroz `recent_errors` (postojeći testovi: vlasnica salona ne vidi ništa, neprijavljen ne sme da pozove). Ko briše: samo vlasnik platforme (`clear_error_events`).
- Retencija: 30 dana, brisanje pri svakom upisu. Postoji.
- PII: `message` i `stack` dolaze iz izuzetaka; server `message` nosi tekst PostgREST-a (`Zakazivanje nije uspelo: ${error.message}`). PostgREST poruke za povredu ograničenja ne nose vrednosti kolone (to je u `details`), pa broj telefona verovatno ne ulazi — NEEDS VERIFICATION na stvarnom PostgREST-u. Zod izuzeci mogu da nose ulaz; `bookingDataSchema.parse` je nad podacima iz baze, ne od korisnika.
- URL: `path` = `window.location.pathname` (bez upita); server `request.path` nosi token kalendara (F-18).
- Minimalna privacy-safe implementacija: kofe po izvoru, `stack` do 2.000, retencija 7 dana, zamena `/api/kalendar/salon/<uuid>` u putanji, filtriranje `\+381\d{8,9}` regexom u `message` pre upisa.

## PWA

Manifest ispravan (`standalone`, 192/512/maskable, `theme_color`). Servis radnik postoji samo za push (`install` → `skipWaiting`, `activate` → `clients.claim`, bez keširanja — namerno: „kalendar koji pokaže jučerašnje stanje je gori"). Nema `fetch` obrađivača i offline stranice (F-15). Update strategija: `reloadIfStaleBuild` osvežava stranu jednom kad stigne nova verzija (testirano `tests/domain/stale-build.test.ts`). `viewport` nema `viewportFit: 'cover'` i nigde se ne koristi `env(safe-area-inset-*)`; bez `cover` iOS sam ostavlja bezbedne margine u standalone modu, pa nema oštećenja — NEEDS VERIFICATION na pravom iPhone-u (Chromium ne emulira Safari niti tastaturu).

## Mobile UX

Prošao sam tok kao nov korisnik na 375×667: usluga → dan → vreme → ime → telefon → potvrda = 3 dodira + 2 polja + 1 dodir (ako je jedna usluga, korak 1 se preskače). Bez nejasnih trenutaka „šta sad": izabrane stavke ostaju kao redovi sa „Promeni", greške se prikazuju ispod dugmeta i ostavljaju uneto ime i broj (postoji E2E), poruke su na srpskom. Nalazi: „Nazad" gubi izbor, nema stanja „proveri da li je zakazano" posle greške veze (F-02), „Promeni" ispod 44 px. Ne predlažem nove funkcije.
NEEDS VERIFICATION: tastatura, safe area, sticky elementi, sporo 3G i instalacija na pravom uređaju (headless Chromium ih ne pokazuje verno).

## Performance

Javna strana: 1 DB poziv. `public_booking_data` vraća zauzeto vreme za ceo horizont (do 90 dana) kao listu opsega; sa ~30 termina dnevno to je oko 50–60 KB JSON-a, prihvatljivo. Analizirano EXPLAIN-om: bez potrebe za dodatnim indeksom. JS: `buildAvailability` je O(dani × blokovi × kandidati × zauzeto); za horizont 90 dana i ~1.000 zauzetih opsega ne pravi problem u pregledaču, nisam merio na sporom telefonu.

## Database / Indexes

Postojeći, opravdani: `appointments_no_overlap` (GiST na `staff_id`, `blocked_range`, delimičan), `appointments_tenant_id_start_at_idx`, `appointments_staff_id_start_at_idx`, `clients_tenant_id_phone_key` (unique), `tenants_slug_key`, `working_hours_no_overlap` (GiST), `time_off_staff_id_start_at_idx`, `appointment_events_network_hash_idx` (delimičan), `phone_lookup_attempts_network_idx`.

Nedostaju: nijedan koji bih dokazao. Upit po `device_id` nema indeks, ali plan ide preko upcoming termina (0,3 ms uz 30.000 događaja). `messages.appointment_id` (FK bez indeksa) i `push_subscriptions.user_id` (u politici) su mali — ne predlažem.

Moguće suvišni (mali, ne dirati): `clients_tenant_id_idx`, `services_tenant_id_idx`, `staff_tenant_id_idx` (pokriveni unique `(tenant_id, id)`). Zarada je zanemarljiva.

## Testing

| Scenario | Test postoji? | Nivo | Rizik |
|---|---|---|---|
| Booking (uspeh, odbijenice, limiti) | Da | DB (`public-booking.test.ts`, 1810 linija), E2E (1 tok) | Nizak |
| Concurrency (paralelne konekcije) | **Ne** (pre revizije) → sad `tests/audit/db/concurrency.repro.ts` | DB | Srednji (F-05) |
| Buffer | Delimično (`constraints.test.ts`: buffer u ograničenju) | DB | Nizak; nema testa „usluga ima buffer" jer ne postoji |
| DST | Da (`availability.test.ts`, `constraints.test.ts`) + paritet | Domain/DB | Nizak |
| Absence | Da (`time-off.test.ts`, `availability.test.ts`) | Domain/DB | Nizak |
| Split shifts | Da + paritet | Domain/DB | Nizak |
| RLS / cross-tenant | Da (`rls.test.ts`, `constraints.test.ts`) + `rls.verified.ts` | DB | Nizak |
| Anonymous access | Da (`anon-surface.test.ts`) | DB | Nizak; ne pokriva zloupotrebu argumenata (F-01) |
| Idempotency | **Ne** | — | Visok (F-02) |
| Duplicate request | **Ne** | — | Srednji |
| Cancellation (javno) | Da (`public-cancel.test.ts`, 447 linija) | DB | Nizak |
| Cron (`complete_past_appointments`) | Da (DB), ruta nema testa | DB | Nizak |
| `x-real-ip` putanja mreže | **Ne** (testna baza nema `pgcrypto`, `extensions` šemu) | — | Srednji |
| Auth (callback, middleware) | Ne | — | Srednji; traži GoTrue |
| E2E | 3 testa (zakazivanje, nepostojeći salon, odbijenica) | E2E | Srednji |

## CI/CD

`ci.yml`: typecheck, lint, `npm test`, `next build`, DB testovi (`postgres:17` bez `pgcrypto`), Playwright preko `supabase start`, `npm audit` sa `continue-on-error: true`. Nema: blokade na `critical` (F-04), test paralelnog zakazivanja, `pgcrypto` u DB poslu (putanja `x-real-ip` je netestirana u CI-ju), provere `supabase db lint`. `backup.yml`: šifrovana kopija (`age`) + probno vraćanje, dobro urađeno.

Da li postoji zaštita `main` grane i obavezni statusi: NEEDS VERIFICATION (podešavanje na GitHub-u, nemam pristup).
Predlog bez komplikovanja: PR policy — obavezni `Provere`, `Baza`, `Kritični tok`; produkcija — Vercel deploy samo sa `main`, `npm audit --omit=dev --audit-level=critical` kao blokirajući korak.

## Code Quality

Čisto. Stvari koje imaju vrednost:
- CLAUDE.md (model podataka) je zastareo: `services.buffer_after_min`, `pending` sa istekom od 30 min (nijedan kod ne upisuje `pending`; `public_book` i `create_appointment` upisuju `confirmed`), `client_identities`, `risk_events`, `deposits`, `waitlist` ne postoje (Faza 4 — očekivano). Uskladiti opis sa stanjem, inače naredna revizija (ili agent) „popravlja" nepostojeće bug-ove kao što je ovaj buffer.
- `lib/domain/phone.ts:13` komentar (F-13).
- Magični brojevi limita su konstante u `booking_limit_reason` i `phone_lookup_limit_reason` (nisu dupli, dokumentovani).
- Progutani izuzeci (`catch {}`) su namerni i komentarisani (`logError`, `/api/greske`, cookie set u server komponenti); `settings-forms.tsx:231` ima prazan `catch {}` bez komentara — jedini koji nema obrazloženje.

---

## F-16 / F-17 (INFO)

### F-16
ID: F-16
SEVERITY: INFO (odluka proizvoda)
STATUS: CONFIRMED
CATEGORY: Booking / spec drift
TITLE: Proizvod nema buffer posle usluge, iako CLAUDE.md kaže da ima
PROBLEM: v. odeljak „Buffer". Nema polja `services.buffer_after_min`; `public_book` upisuje `buffer_after_min = 0`.
WHY IT MATTERS: Nokat-tehničarki koja hoće 15 min pauze posle svake usluge ostaje samo da podesi razmak termina (`slot_minutes` = trajanje + pauza), pa i kratke usluge zauzimaju istu pauzu. Da li je to dovoljno je tvoja odluka.
MINIMAL FIX: Ništa; ažurirati CLAUDE.md. Ako je buffer potreban: kolona `services.buffer_after_min` + `public_book` je upisuje u `appointments.buffer_after_min` (`blocked_range` i JS busy već rade sa njim; `parity.verified.ts` to dokazuje). JS `availability.ts` ne mora da se menja jer prima gotove busy opsege.

### F-17
`pending` status (drži termin 30 min pa ističe) nije implementiran; CLAUDE.md ga opisuje. INFO.

---

## Top 10 Action Plan (redosled po stvarnim nalazima)

1. Zatvoriti direktan anon pristup zloupotrebljivim RPC-ovima (F-01, F-07, F-10, deo F-09).
2. Idempotentan `public_book` + tekst „proveri da li je zakazano" (F-02).
3. Advisory lock po broju telefona (F-05).
4. `next` → 15.5.26, `npm audit` gate na `critical` (F-04).
5. `log_error`: kofe po izvoru, manji stack, kraća retencija (F-03).
6. Integritet audit loga: ukloniti INSERT politiku, zabraniti DELETE termina (F-06).
7. `addSalon`: provera pre `ensureUser` (F-08).
8. Čišćenje `phone_lookup_attempts` (F-09).
9. Provera formata push endpoint-a; `signOut({scope:'local'})` (F-11, F-12).
10. Test-higijena: pomeriti `tests/audit/*.verified.ts` i ispravljene repro testove u glavni skup, `pgcrypto` u DB CI posao, uskladiti CLAUDE.md (F-16, F-17).

## Patch Plan

**1. Direktan anon pristup**
FILES TO CHANGE: nova migracija; `lib/db/public-booking.ts`, `lib/db/public-cancel.ts` (klijent → `createAdminClient()`), `tests/db/anon-surface.test.ts`
EXPECTED CODE CHANGE: `revoke execute on function public_book(...), public_cancel_appointment(...), public_appointments_for_phone(...) from anon, authenticated; grant … to service_role;` u funkcijama regex `^\+381[1-9][0-9]{7,8}$` i `date_trunc('minute', p_start_at) = p_start_at`.
NEW TESTS: `abuse.repro.ts` (F-01, F-07), `misc.repro.ts` (F-10) prolaze; `anon-surface` očekuje `permission denied`.
RISK OF CHANGE: srednji — javno zakazivanje i otkazivanje zavise od service ključa u Vercel okruženju (`SUPABASE_SERVICE_ROLE_KEY` je već potreban za push). Proveriti pre deploy-a.
ESTIMATED COMPLEXITY: M

**2. Idempotentnost**
FILES TO CHANGE: nova migracija (`public_book`), `lib/i18n/sr.ts`
EXPECTED CODE CHANGE: upit za postojeći termin (phone, service, start_at, source='public', `created_at > now() - interval '10 minutes'`) pre `booking_limit_reason`, vraća `ok:true` sa istim `id`.
NEW TESTS: `concurrency.repro.ts` (drugi test), `lost-response.repro.ts`.
RISK OF CHANGE: nizak; pažnja da ponovljen zahtev ne šalje ponovo push obaveštenje (`after()` u `actions.ts` — vratiti flag `replayed`).
ESTIMATED COMPLEXITY: S

**3. Advisory lock**
FILES TO CHANGE: nova migracija (`public_book`)
EXPECTED CODE CHANGE: jedan `perform pg_advisory_xact_lock(hashtextextended(...))`.
NEW TESTS: `concurrency.repro.ts` (limit).
RISK OF CHANGE: nizak (serijalizuje samo isti broj u istom salonu).
ESTIMATED COMPLEXITY: S

**4. Zavisnosti i CI**
FILES TO CHANGE: `package.json`, `package-lock.json`, `.github/workflows/ci.yml`
EXPECTED CODE CHANGE: `next`/`eslint-config-next` 15.5.26; korak `npm audit --omit=dev --audit-level=critical` bez `continue-on-error`.
NEW TESTS: postojeći skup + build.
RISK OF CHANGE: nizak (patch).
ESTIMATED COMPLEXITY: S

**5. `log_error`**
FILES TO CHANGE: nova migracija
EXPECTED CODE CHANGE: brojanje po `source`, `left(p_stack, 2000)`, retencija 7 dana.
NEW TESTS: `abuse.repro.ts` („poplava…"); postojeći `error-events.test.ts` menja se za novi limit (10/min klijent).
RISK OF CHANGE: nizak; manje grešaka od klijenata u evidenciji.
ESTIMATED COMPLEXITY: S

**6. Audit log**
FILES TO CHANGE: nova migracija; `tests/db/rls.test.ts` (test „dozvoljava upis novog reda…" se menja)
EXPECTED CODE CHANGE: `drop policy appointment_events_insert`; `revoke delete on appointments from authenticated`.
NEW TESTS: `abuse.repro.ts` (2 testa).
RISK OF CHANGE: srednji — proveriti da nijedan tok ne briše termin (grep u `app/`, `lib/` je čist) i da `delete_tenant` (definer) i dalje briše.
ESTIMATED COMPLEXITY: S

**7. `addSalon`**
FILES TO CHANGE: `app/(dashboard)/admin/actions.ts`
EXPECTED CODE CHANGE: `isPlatformOwner()` provera na početku.
NEW TESTS: unit test akcije.
RISK OF CHANGE: nizak.
ESTIMATED COMPLEXITY: S

**8. `phone_lookup_attempts`**
FILES TO CHANGE: nova migracija
EXPECTED CODE CHANGE: `delete … where created_at < now() - interval '1 day'` u jednoj od funkcija.
NEW TESTS: DB test retencije.
RISK OF CHANGE: nizak.
ESTIMATED COMPLEXITY: S

**9. Push endpoint + signOut**
FILES TO CHANGE: nova migracija, `app/(dashboard)/dashboard/actions.ts`
EXPECTED CODE CHANGE: `check` na `endpoint`; `signOut({ scope: "local" })`.
NEW TESTS: `misc.repro.ts` (endpoint).
RISK OF CHANGE: srednji — pogrešna lista dozvoljenih hostova prekida obaveštenja; proveriti postojeće pretplate upitom pre migracije.
ESTIMATED COMPLEXITY: S

**10. Test-higijena i dokumentacija**
FILES TO CHANGE: `.github/workflows/ci.yml` (`create extension pgcrypto with schema extensions` u DB poslu), `tests/db/bootstrap.sql`, `CLAUDE.md`, `tests/audit/*` → `tests/db/*`
EXPECTED CODE CHANGE: bootstrap pravi `extensions` šemu i `pgcrypto`; CLAUDE.md model podataka usklađen.
NEW TESTS: kontrola „bez p_network_hash važi x-real-ip" (već u `abuse.repro.ts`).
RISK OF CHANGE: nizak.
ESTIMATED COMPLEXITY: S

---

## Dodati testovi (`tests/audit/`)

Ne pokreću se uz `npm test` / `npm run test:db` / `npm run test:e2e`.

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres \
  npx vitest run --config tests/audit/vitest.config.ts
AUDIT_SLUG=studio-milica npx playwright test -c tests/audit/playwright.config.ts
```

| Fajl | Tip | Trenutno |
|---|---|---|
| `db/concurrency.repro.ts` | paralelne konekcije | 3 prolaze, 2 padaju (F-05, F-02) |
| `db/abuse.repro.ts` | mreža, `log_error`, audit log, blocklist | 1 prolazi (kontrola), 6 pada (F-01×2, F-03, F-06×2, F-07) |
| `db/misc.repro.ts` | strani broj, sekunde, push endpoint | 3 padaju (F-13, F-10, F-11) |
| `db/parity.verified.ts` | JS ↔ SQL, DST, smene, odsustvo, buffer | 8 prolazi |
| `db/rls.verified.ts` | cross-tenant, anon | 8 prolazi |
| `e2e/lost-response.repro.ts` | Playwright, izgubljen odgovor | pada (F-02) |
| `db/concurrency.ts` | pomoćni fajl (stvarni commit + čišćenje) | — |

Ukupno DB: 31 test, 20 prolazi, 11 pada (svaki pad = jedan nalaz). Postojeći skup posle dodavanja: 388/388 DB, 206/206 unit; `typecheck` i `lint` čisti.

## Šta nisam mogao da potvrdim

1. Stvarno ponašanje GoTrue-a: jednokratnost magic linka, istekla sesija, nevažeći token, Supabase allow-lista redirect URL-ova (utiče na host-header ublažavanje u `siteOrigin`).
2. PostgREST u produkciji: format `request.headers` i prisustvo `pgcrypto` u šemi `extensions` (putanja `x-real-ip` radi u mom testu tek kad sam napravio `pgcrypto`; produkcija, Supabase ga nosi podrazumevano — nije proveravano).
3. Vercel: da li prepisuje `x-forwarded-for`, kakva zaglavlja dodaje.
4. Pravi iPhone Safari i Android Chrome: tastatura, safe area, sticky, back/forward keš, instalacija PWA, „Slow 3G". Rađeno samo Chromium emulacijom.
5. Da li `next@15.5.23` advisory-ji (AVIF RCE, Windows RCE) pogađaju ovu konfiguraciju.
6. F-08: da li obična sesija može da pozove `addSalon` (traži GoTrue + Next-Action ID).
7. Da li `web-push` odbija `http://` endpoint (F-11).
8. Zaštita grane `main`, GitHub Actions istorija izvršavanja, Vercel podešavanja (planovi/limiti skladišta za F-03).
9. Odsustvo se ne proverava u `create_appointment` (salon ručno) — nije proveravano da li je namerno; `docs/faza-2.md` to ne pominje.
10. DST 2027-03-28 kroz `public_book` (van horizonta od 90 dana danas).
