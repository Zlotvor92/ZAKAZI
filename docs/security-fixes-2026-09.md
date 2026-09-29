# Popravke iz revizije (DOTERAJME_FULL_AUDIT.md, commit 6c52330)

Grana `fix/production-security-reliability`.

| Nalaz | Šta je urađeno | Migracija | Test koji dokazuje |
|---|---|---|---|
| F-01 | `public_book`, `public_cancel_appointment`, `public_appointments_for_phone` više ne mogu da zovu `anon` ni `authenticated`; zove ih server sa `service_role`, hash mreže računa server | `20260928000000_public_rpc_server_only` | `tests/db/public-rpc-server-only.test.ts`, `tests/domain/network.test.ts` |
| F-02 | `request_id` (UUID iz pregledača) → `appointments.request_id`, jedinstven po salonu; isti zahtev vraća isti termin (`replayed`), bez klijenta, događaja i obaveštenja; poruka posle prekinute veze ne tvrdi da ništa nije sačuvano | `20260928010000_booking_idempotency` | `tests/db/booking-concurrency.test.ts`, `tests/actions/booking-action.test.ts`, `tests/e2e/lost-response.spec.ts` |
| F-05 | advisory lock po (salon, broj) pre limita | `20260928020000_phone_limit_lock` | `tests/db/phone-limit-concurrency.test.ts` |
| (novo) | advisory lock po izvođaču pre upisa + `deadlock_detected` → `slot_taken`: dva istovremena zahteva za isti termin su znala da završe sa `deadlock detected` | isto | `tests/db/booking-concurrency.test.ts` (5 rundi po 20) |
| F-03, F-18 | `log_error` samo za `service_role`; odvojene kofe (klijent 10/min, server 60/min); poruka 300, stack 2000, putanja 200; mejl/telefon/UUID brisani; token kalendara u putanji → `[token]`; retencija 7 dana | `20260928030000_error_log_abuse` | `tests/db/error-events.test.ts`, `tests/domain/redact.test.ts`, `tests/actions/log-error.test.ts` |
| F-04 | `next` i `eslint-config-next` 15.5.26; CI blokira `critical` u produkciji | — | `npm audit --omit=dev --audit-level=critical` (izlaz 0); preostalo u `docs/security-advisories.md` |
| F-06 | uklonjena INSERT politika nad `appointment_events`; oduzet DELETE nad `appointments`; strani ključ `on delete restrict` | `20260928040000_audit_log_integrity` | `tests/db/rls.test.ts` (blok „appointment_events piše samo baza") |
| F-08 | provera vlasnika platforme pre `ensureUser` | — | `tests/actions/admin-add-salon.test.ts` |
| F-07 | broj mora `+381[1-9]…`; ograničenja `not valid` (postojeći redovi netaknuti) | `20260928050000_canonical_phone_minute_start_prune` | `tests/db/canonical-phone-and-start.test.ts` |
| F-10 | `is_bookable_start` traži ceo minut | isto | isto |
| F-09 | `prune_phone_lookup_attempts` (starije od 1 dana) u postojećem noćnom cron-u | isto | isto, `tests/actions/cron.test.ts` |

## Primenjeno u produkciji (2026-09-29)

- **Vercel:** `SUPABASE_SERVICE_ROLE_KEY` je već bio postavljen (Production i Preview), nije menjan. Produkcioni deploy `dpl_77DsP6x4FnUbVKpssDc76PQqGH5D` (commit `a1771b4`, `main`) je READY na `doterajme.rs`.
- **Supabase:** šest migracija `20260928000000` … `20260928050000` primenjeno u jednoj transakciji, upisane u `supabase_migrations.schema_migrations` (71 zapis). Pre toga: probni prolaz u transakciji koja se poništava i lokalna kopija svih tabela i definicija funkcija (Supabase nije imao svoje kopije; PITR je isključen).
- **Podaci pre F-07:** 0 redova sa `+3810…` u `clients`, `limit_exempt_phones` i `blocklist`. Ograničenja su ipak ostala `NOT VALID`; može `validate constraint` za `clients_phone_e164_format` i `limit_exempt_phones_phone_e164_check` kad želiš.
- **Prozor bez zakazivanja:** oko dva minuta, između migracija i kraja build-a nove verzije (stara verzija je zvala funkcije kao `anon`).

### Provera u produkciji

| Šta | Ishod |
|---|---|
| javna strana `/salon-smiley` | 200; usluge, dani, termini se prikazuju; forma nosi `requestId` (36 znakova) |
| `/salon-smiley/otkazi`, pretraga po nepostojećem broju (server → `service_role`) | „Nema zakazanih termina za taj broj", bez greške |
| anon → `public_book`, `public_appointments_for_phone`, `log_error` preko REST-a | 401 `permission denied` |
| anon → `public_booking_data` | 200 |
| anon → `select` nad `appointments` | 401 `permission denied` |
| `public_book` kao `service_role`, u transakciji koja se poništava | prvi poziv `ok`; isti `request_id` ponovo `ok` + `replayed`; broj sa nulom `invalid_phone`; `09:00:00.4` `outside_working_hours` |
| ostaci posle provere | 0 test termina, 0 test klijenata, ukupno 72 termina kao pre |
| `appointment_events` INSERT politike | 0 |

**Nije proveravano u produkciji:** stvarno zakazivanje kroz formu (napravilo bi pravi termin i push obaveštenje salonu; audit log ga više ne bi dozvolio da obrišem) i noćni cron sa `prune_phone_lookup_attempts` (`CRON_SECRET` je `sensitive` i ne može da se pročita; prvi put radi po rasporedu u 01:00 UTC).

## Nije popravljeno (van zadatka)

F-11 (push endpoint), F-12 (`signOut` globalno), F-13 (strani broj u `create_appointment`), F-14 (zaglavlja), F-15 (Back dugme, offline). Dokazi za F-11 i F-13 su u `tests/audit/` i padaju.
