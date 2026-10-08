# Zaštita otkazivanja: broj telefona sam ne otvara termin

Stanje: 8. oktobar 2026. Migracija `20261008050000_cancel_requires_proof.sql`.

## Problem

Za pregled i otkazivanje preko sajta bio je dovoljan broj telefona. Broj nije tajna
(salon ga ima, klijentkinja ga daje svakome), pa je ko zna tuđ broj mogao da vidi i
otkaže njene termine. Ograničenja po mreži i po broju su samo ublažavala štetu.

## Odluka

Termin se otvara tek kad se poklope **broj telefona i dokaz** da je zakazan sa ovog
pregledača. Forma „Pronađi svoj termin" ostaje ista (upiše se broj); razlika je u tome
što broj bez dokaza ne vraća ništa.

| Dokaz | Odakle | Čuva se |
|---|---|---|
| Tajna termina, 256 bita (`manageProof`) | pregledač je smisli pri zakazivanju; server je stavlja u `httpOnly` kolačić `zakazi_termini` (putanja `/<slug>`, `SameSite=Lax`, 120 dana, najviše 6 tajni) | u bazi samo SHA-256 (`appointments.manage_proof_hash`) |
| Link `/<slug>/otkazi#k=<tajna>` | ista tajna, iza `#` (pregledač je ne šalje serveru) | nigde na serveru; klijentkinja ga sama sačuva (potvrda nudi dugme) |
| Uređaj (samo termini bez tajne, tj. zakazani pre ove izmene) | `zakazi_device` kolačić poređen sa `device_id` na događaju nastanka termina, uz uslov da je akter klijentkinja | već u `appointment_events` |

Jedan SQL predikat (`owned_appointment_ids`) odlučuje o vlasništvu i za pregled
(`public_appointments_for_proof`) i za otkazivanje (`public_cancel_appointment`), pa
ne mogu da se razilaze.

## Šta se tačno garantuje

- Broj bez dokaza, dokaz bez broja, tuđ salon, nepostojeći termin: isti odgovor
  (`not_found` / prazan spisak). Iz razlike se ne može pročitati da li termin postoji.
- Baza nikad ne vidi ni ne čuva tajnu: ni salon (RLS), ni dump, ni `appointment_events`.
- Tajna iz linka ulazi u kolačić tek kad sama otvara termin tog broja; izmišljen
  link ne može da istisne prave tajne.
- Stari oblici `public_appointments_for_phone` i `public_cancel_appointment(phone,…)`
  su obrisani. Stari kod za vreme puštanja dobija grešku, ne lažno „nema termina".
- Ostaje ograničenje od 3 samootkazivanja dnevno po broju i salonu.

## Šta se ne garantuje (odluke vlasnika proizvoda)

1. **Novi telefon, obrisani podaci, privatni prozor, drugi pregledač bez linka:**
   klijentkinja ne može sama da otkaže; javlja se salonu, koji otkazuje iz kalendara.
   Pregledači unutar aplikacija (Instagram/Facebook) imaju svoje kolačiće; da li ih
   čuvaju danima — **nedovoljno dokaza**, treba proveriti na pravim telefonima
   (vidi `docs/qa-matrica.md`). Zato potvrda nudi „Sačuvaj link za otkazivanje".
2. **Termini koje je upisala vlasnica salona** nemaju ni tajnu ni klijentski uređaj,
   pa se preko sajta ne otkazuju.
3. Link nije u `.ics` fajlu: tajna bi tada morala u GET upit (log, `Referer`), a
   prelazak na POST rizikuje dugme „Dodaj u kalendar" u Instagram/iOS pregledačima.
4. Sam broj telefona i dalje ostaje poznat salonu i svima kojima ga je klijentkinja
   dala; ovo ga ne skriva, samo ga čini nedovoljnim.
5. `device_id` u `appointment_events` je isti u svim salonima i vidljiv članovima
   salona. Zato novi termini ne koriste uređaj kao dokaz. Za termine zakazane pre ove
   izmene (najviše `booking_horizon_days`, podrazumevano 14 dana) uređaj ostaje
   jedini dokaz; grana nestaje sama čim takvih termina više nema (`manage_proof_hash is null`
   u `owned_appointment_ids` se tada skida).
6. Tabela `phone_lookup_attempts` i njene funkcije ostaju, ali ih otkazivanje više ne
   piše (tajna od 256 bita se ne pogađa). Mogu da se skinu posebnom migracijom.

## Šta bi tražilo SMS ili sličan drugi kanal

Dokaz „imam telefon na koji stiže kod" rešava novi telefon i drugi pregledač bez
linka, ali traži SMS/Viber kanal i cenu po poruci (`messages.cost_estimate`). To je
posebna odluka; ovde nije ugrađeno.
