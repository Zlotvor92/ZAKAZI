# Zaštita otkazivanja: broj telefona sam ne otvara termin

Stanje: 9. oktobar 2026. Otkazivanje preko sajta je moguće u svako doba; otkazivanje manje od 24 sata pre termina se broji, a posle dva takva sajt više ne dozvoljava samostalno zakazivanje (migracija `20261009000000_late_cancel_strikes.sql`). Migracija `20261008050000_cancel_requires_proof.sql`.

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
   izmene (najviše `booking_horizon_days`, podrazumevano 14 dana, a salon ga može podići) uređaj ostaje
   jedini dokaz; grana nestaje sama čim takvih termina više nema (`manage_proof_hash is null`
   u `owned_appointment_ids` se tada skida).
6. **Forma za zakazivanje i dalje odaje ponešto o broju** (nije uvedeno ovom izmenom,
   a nije ni zatvoreno): ko pokuša da zakaže na tuđ broj dobija poruke koje zavise od
   njenih termina — „već imaš dva termina te nedelje", rok usluge (`service_window`) i
   redosled usluga (`service_sequence`, sa nazivom usluge i datumom njenog termina).
   Otkazati ne može, ali može da sazna da termin postoji i kada. Zatvaranje znači
   opštije poruke, što klijentkinji koja zaista ima sukob oduzima objašnjenje; to je
   odluka vlasnika proizvoda.
7. **Samootkazivanje se zaključava dnevnim ograničenjem.** Ograničenje od 3 otkazivanja dnevno po
   broju broji i otkazivanja koje je pokrenula treća osoba: ko zna broj može da zakaže
   i otkaže tri termina na njega, pa prava klijentkinja ne može da otkaže sama do
   sutra. Salon otkazuje iz kalendara. Nije šteta po termine, samo po udobnost.
8. Tabela `phone_lookup_attempts` i njene funkcije ostaju, ali ih otkazivanje više ne
   piše (tajna od 256 bita se ne pogađa). Mogu da se skinu posebnom migracijom.

## Kasno otkazivanje (manje od 24 sata)

Preko sajta se otkazuje u svako doba, ali otkazivanje kad do početka termina ima manje od 24 sata
je „kasno" i broji se. Posle **dva** kasna otkazivanja u istom salonu, sa istog broja, `public_book`
vraća `too_many_late_cancellations` i klijentkinja se šalje salonu.

- Brojač nije posebna kolona: izvodi se iz `appointment_events` (`actor_type = 'client'`,
  `to_status = 'cancelled_by_client'`, `start_at < trenutak događaja + 24 sata`). Audit log je
  nepromenljiv, pa brojač ne može da se prepravi; isti prag kao ranije (`now()` servera, sat uređaja
  ne utiče).
- Po salonu i po broju. **Bez isteka** — odluka je pretpostavljena iz zahteva (primer: decembar pa
  januar), nije potvrđena. Prozor (npr. poslednjih 180 dana) je jedan uslov u `booking_limit_reason`.
- Računa se samo otkazivanje preko sajta. Salon koji u kalendaru označi termin kao „otkazala
  klijentkinja" ne dodaje ništa.
- Izuzeti brojevi (`limit_exempt_phones`) preskaču brojač; `blocklist` ostaje ispred svega.
- Salon oprašta dugmetom „Oprosti" na kartici klijentkinje (vidi se kad broj ima bar jedno kasno
  otkazivanje). U `late_cancel_pardons` se upiše red (salon, broj, ko, kada) i brojač od tada broji
  samo otkazivanja posle poslednjeg oproštaja. Audit log se ne dira, a oproštaj se ne menja ni
  briše. Ne može da se poništi, ali ako je pogrešan, brojač kreće od nule pod istim pravilom.
  Salon takođe može da upiše termin ručno iz kalendara (ne ide kroz `booking_limit_reason`).
- Spisak termina vraća `late` i ekran upozorava pre otkazivanja, da kazna ne stigne neviđena.
- Otkazivanje koje pokrene treća osoba (ko zna broj i ima dokaz) takođe se računa; dokaz je
  tajna od 256 bita, pa to ostaje na istom nivou rizika kao samo otkazivanje.

## Šta bi tražilo SMS ili sličan drugi kanal

Dokaz „imam telefon na koji stiže kod" rešava novi telefon i drugi pregledač bez
linka, ali traži SMS/Viber kanal i cenu po poruci (`messages.cost_estimate`). To je
posebna odluka; ovde nije ugrađeno.
