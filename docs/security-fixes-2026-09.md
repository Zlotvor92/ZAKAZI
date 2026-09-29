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

## Ručno, pre i posle deploy-a

1. **`SUPABASE_SERVICE_ROLE_KEY` mora biti postavljen u Vercel-u (Production i Preview).** Bez njega više ne rade javno zakazivanje, otkazivanje, pretraga po broju ni upis grešaka. Postavlja se u Vercel → Project Settings → Environment Variables; posle toga nov deploy.
2. **Redosled:** migracije `20260928000000` … `20260928050000` i nov deploy aplikacije treba da idu jedno za drugim, u periodu sa malo saobraćaja. Stara verzija aplikacije ne radi posle prve migracije (zove funkcije kao `anon`), a nova ne radi bez druge (šalje `p_request_id`). Prozor je kratak, ali postoji.
3. **Pregled podataka pre `validate`** (F-07): upit je u komentaru migracije `20260928050000`. Ako vrati redove, oni ostaju netaknuti dok se ne obrade; tek onda `alter table … validate constraint …` za `clients_phone_e164_format` i `limit_exempt_phones_phone_e164_check`.
4. Migracija `20260928030000` briše `error_events` starije od 7 dana.

## Nije popravljeno (van zadatka)

F-11 (push endpoint), F-12 (`signOut` globalno), F-13 (strani broj u `create_appointment`), F-14 (zaglavlja), F-15 (Back dugme, offline). Dokazi za F-11 i F-13 su u `tests/audit/` i padaju.
