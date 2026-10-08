# QA matrica i provera na telefonu

Prati „Završnu QA matricu" iz izveštaja od 8. oktobra 2026. Kolona **Pokriveno**
kaže šta automatski test stvarno dokazuje; **Ručno** je ono što test ne može da
vidi. Prazno polje znači da ništa nije proveravano — ne da je u redu.

CI pokreće browser testove nad `next build` + `next start` (Android/Chromium).
WebKit (iPhone) je u CI-ju uključen kao informativan korak; ni jednom još nije
viđen zelen.

| Scenario | Pokriveno | Ručno |
|---|---|---|
| Dva klijenta biraju isti termin istovremeno | `tests/db/booking-concurrency.test.ts` (prava trka, bez mock-ova) | |
| Dupli klik i izgubljen odgovor | `booking-concurrency` (isti `request_id`), `tests/e2e/lost-response.spec.ts` | |
| Usluga 75 min → 105 min, ručni override | `tests/domain/appointment-form.test.ts` (opcije i početni izbor), `tests/domain/durations.test.ts` | Menjanje usluge u formi i ručni izbor trajanja (izbor se ne simulira, samo početno stanje) |
| Izmena radnog vremena / odsustvo / gašenje usluge | `tests/domain/working-hours.test.ts`, `tests/db/time-off.test.ts`, `manage-services.test.ts`, `appointments-outside-hours.test.ts` | Kombinacije u prijavljenom interfejsu |
| Ponoć i prelazak na zimsko (25.10.2026) | `tests/db/availability-parity.test.ts`, `tests/domain/calendar.test.ts` | |
| Tuđ telefon: ko zna samo broj | `tests/db/public-cancel.test.ts` (broj bez tajne, pogrešan broj, tuđa tajna, tuđ salon: isti odgovor), `tests/e2e/find-appointment.spec.ts` (drugi pregledač ne vidi ništa; izmišljen link ne otvara) | |
| Pregledač bez kolačića, sa sačuvanim linkom | `find-appointment.spec.ts` (link + broj otvara termin, tajna se pamti, link nestaje iz adrese), `tests/actions/cancel-action.test.ts` (izmišljen link ne ulazi u kolačić) | **Na uređaju**: zakazivanje u Instagram/Facebook pregledaču → otkazivanje preko linka u Safariju/Chrome-u |
| Termini zakazani pre tajne | `public-cancel.test.ts` (prelazna grana: uređaj; vlasničin uređaj se ne priznaje) | |
| Istek kolačića, novi telefon | — | Nema samostalnog puta: klijentkinja se javlja salonu. Meri se brojem takvih poruka |
| Uspešno otkazivanje pa izgubljen odgovor | `tests/actions/cancel-action.test.ts` (već otkazan = uspeh), DB `already_cancelled` | Prekid veze usred otkazivanja u pravom pregledaču |
| Istek access tokena pri ulasku preko početne/prijave | `tests/supabase/middleware.test.ts` (kolačići na redirectu; sa mock-ovanim Supabase klijentom) | Stvarna prijava i istekla sesija |
| Korisnik A → salon B | `tests/db/rls.test.ts`, `cross-tenant-writes.test.ts` | |
| Jedan telefon, dva salona; dva telefona, jedan salon | `tests/db/push-subscriptions.test.ts`, `tests/actions/push-settings.test.ts` | Dva stvarna salona na istom telefonu |
| Push pri otvorenom kalendaru / ugašenoj aplikaciji | `tests/pwa/service-worker.test.ts` (ponašanje radnika u `vm`-u), `tests/actions/open-dashboard.test.ts` | **Obavezno na uređaju**: stvarna notifikacija, dodir, ispravan salon i dan |
| Odbijena dozvola, istekao endpoint, promena naloga | `push-settings.test.ts` (status „nepoznato", gašenje po salonu) | Odbijanje dozvole u sistemu, odjava i prijava drugog naloga |
| iPhone Safari i instalirana PWA; Android Chrome/PWA | WebKit korak u CI-ju (informativno) | **Obavezno** — lista ispod |
| Offline tokom upisa i povratak online | `tests/e2e/offline-booking.spec.ts` (javno zakazivanje) | Banner u kalendaru vlasnice i „Pokušaj ponovo" |
| Logo 1,5 MB / 2 MB / preko granice | `tests/domain/logo.test.ts` (funkcija i konfiguracija granice) | Stvarno slanje fajla od ~2 MB u administraciji |
| Admin: status, istek pristupa, produženje | `tests/db/paid-until.test.ts`, `subscription-expiry.test.ts` | |
| ICS pretplata i opoziv tokena | `tests/db/calendar-feed.test.ts`, `tests/domain/ics*.test.ts` | Apple/Google kalendar i njihovi intervali osvežavanja |
| Povratak kopije u izolovano okruženje | Noćna proba i `restore-drill.yml` (pun Supabase stek: prijava, RLS, prava; izvedeno 8.10.2026, `docs/backup-restore.md`) | Vraćanje u pravi (hostovani) Supabase projekat i stvarni `age` ključ — nikad |
| Tastatura, čitač ekrana, zoom 200%, uzak ekran | | **Nije proveravano** |

## Kratka provera na fizičkom telefonu (oko 10 minuta)

Pre objave koja menja zakazivanje, otkazivanje, obaveštenja ili prijavu. Jedan
iPhone (Safari tab **i** instalirana aplikacija sa početnog ekrana) i jedan Android
(Chrome tab i instalirana aplikacija).

Klijentkinja, bez prijave:

1. Otvori stranu salona. Vidi se „Pronađi svoj termin" bez skrolovanja.
2. Zakaži termin. Tastatura ne pokriva dugme za slanje.
3. „Pronađi svoj termin" → upiši isti broj → termin je u spisku → otkaži (dva
   dodira, drugi je potvrda). Salon dobija obaveštenje.
   Isti broj iz drugog pregledača ili privatnog prozora **ne** pokazuje termin;
   isti broj uz sačuvan link („Sačuvaj link za otkazivanje" na potvrdi) pokazuje.
   Zakazano u Instagram pregledaču: zatvori aplikaciju, otvori link iz poruke
   u Safariju/Chrome-u, upiši broj → termin se vidi.
4. Isključi mrežu usred popunjavanja: dugme za slanje je neaktivno, poruka kaže da
   termin nije zakazan. Vrati mrežu: dugme radi.

Vlasnica, prijavljena:

5. Uključi obaveštenja, „Pošalji probno obaveštenje". Stiže na telefon.
6. Neka drugi telefon zakaže termin dok je kalendar otvoren: raspored se osveži bez
   ručnog učitavanja. Zatvori aplikaciju, zakaži opet, dodirni obaveštenje: otvara
   se tačan salon i dan.
7. Ako imaš dva salona: uključi obaveštenja u oba, isključi u jednom. Drugi i dalje
   prima.
8. Isključi mrežu: u kalendaru piše od kada je prikazani raspored. Vrati mrežu:
   osvežava se sam.

Upiši datum, uređaj i šta nije radilo; to je jedini dokaz da je provera urađena.
