# Faza 2 — javno zakazivanje bez ijedne poruke

## Cilj

Vlasnica salona više ne dogovara termine. Link u Instagram bio-u i u automatskom
odgovoru na poruku vodi klijenta na stranicu salona, klijent sam bira uslugu, dan
i sat, i termin je odmah potvrđen. Vlasnica ga vidi u svom kalendaru i ne radi
ništa.

Faza je gotova kad se pilot salon može odjaviti sa Instagram prepiske za
zakazivanje i ne izgubiti nijedan termin.

## Šta je već napravljeno u Fazi 0

- Šema sa svim ograničenjima: preklapanje termina odbija baza, uz buffer
- RLS na svih 10 tabela, testiran iz perspektive drugog tenanta
- Prijava magic linkom, zaštićen dashboard
- Nedeljna mreža koja prikazuje radno vreme

U aplikaciji za sada ne postoji nijedan upis. Faza 2 je prvi put da aplikacija
nešto piše u bazu.

## Odluke koje su donete

| Pitanje | Odluka |
|---|---|
| Potvrda javne rezervacije | Odmah `confirmed`, bez odobrenja vlasnice |
| Vremena početka | Mreža od 15 minuta |
| Trajanje termina | Sa usluge, prepisuje se u trenutku upisa |
| Buffer preko kraja radnog vremena | Sme da pređe, usluga mora da stane |
| Instagram | Ne gradimo integraciju, koristi se ugrađeni automatski odgovor |

### Posledice tih odluka

**Slobodni termini se računaju po usluzi.** Mreža od 15 minuta određuje kad
termin *počinje*, ne koliko traje. Pošto trepavice 1-na-1 traju 3h a manikir 45
minuta, ne postoji jedna lista slobodnih termina za dan. Zato javna stranica
pita uslugu prvo, pa tek onda nudi dane i sate — i traka dana pokazuje samo dane
koji imaju mesta *za tu uslugu*.

**Status `pending` se u Fazi 2 ne koristi.** Javna rezervacija ide pravo u
`confirmed`. Ostaje u šemi i vraća se u Fazi 4, kad se uvede provera broja
telefona. Time otpada cron job za istek `pending` termina.

**Dvoje ljudi mogu da kliknu isti termin u istoj sekundi.** Jedan dobija grešku
`23P01` iz ograničenja u bazi. Funkcija koja upisuje mora tu grešku da uhvati i
vrati poruku „taj termin je upravo zauzet, izaberi drugi", nikad 500. Provera u
kodu pre upisa postoji samo da poruka bude lepša — zaštita je ograničenje u bazi.

## Šta je van obima

Poruke i podsetnici, kapare, reputacioni skor, lista čekanja, pretplate,
Instagram API, super-admin panel, white-label izgled po salonu.

## Tri stvari koje moraju biti unutra iako nisu deo „javne stranice"

### 1. Vlasnica mora sama da unosi termine

Klijentkinja uđe uživo i zakaže sledeći utorak u 17h. Vlasnica to zapiše u
svesku. Aplikacija ne zna. Javna stranica i dalje prodaje utorak 17h. U utorak u
17h dolaze dve žene — i vlasnica se vraća na svesku zauvek.

Sveska mora da umre sto posto, ne osamdeset. Ručni unos termina nije „interni
CRM", nego preduslov da javna stranica sme da postoji.

### 2. Vlasnica mora sama da podesi radno vreme

Bez radnog vremena za neki dan, taj dan nema slobodnih termina. Na prvom ulasku u
podešavanja se ponudi šablon (pon–pet 09–17, subota 09–14, nedelja slobodno) koji
može odmah da se izmeni. Pauza nije poseban pojam — pauza je rupa između dva
intervala istog dana, a to šema već podržava i baza već odbija preklapanje.

### 3. Minimalni pod zaštite

Bez ijedne provere, jedna dosadna osoba popuni celu nedelju za dva minuta.
Bez CAPTCHA, nevidljivo za normalne ljude:

- **Najraniji termin** (`min_lead_minutes`, podrazumevano 120) — ne može neko da
  rezerviše za 10 minuta unapred dok je vlasnica na nogama
- **Horizont** (`booking_horizon_days`, podrazumevano 14) — tvojih 7 / 14 / 21
- **Najviše 2 aktivne buduće rezervacije po broju telefona** unutar salona

## Arhitektura javnog pristupa

Trenutno je svaka RLS politika `to authenticated` — anonimni posetilac ne vidi
ništa. Javna stranica to menja i tu je najveći rizik u celoj fazi: anonimac ne
sme da vidi tabelu `clients`, ni ko je zakazao u 15h.

**Anonimac ne dobija pristup nijednoj tabeli.** Dobija tačno dve funkcije:

```
public_booking_data(tenant_slug text)
  → salon (ime, tajmzona, horizont, lead time)
  → aktivne usluge (ime, trajanje, buffer, cena)
  → radno vreme i odsustva
  → zauzeti intervali: SAMO start i kraj, bez imena, bez usluge, bez ičega

public_book(tenant_slug, service_id, start_at, client_name, phone, device_id)
  → upisuje klijenta i termin atomično, uz sve provere
  → vraća potvrdu ili razlog odbijanja
```

Obe su `security definer` sa fiksiranim `search_path`. Postgres podrazumevano
daje `execute` roli `public`, pa se to prvo mora povući, pa dodeliti eksplicitno
roli `anon`.

Slobodni termini se **ne računaju u SQL-u**. Funkcija vraća samo sirovinu, a
računa ih čista funkcija u `lib/domain/availability.ts` — testirana bez baze,
kako CLAUDE.md traži.

## Motor slobodnih termina

`lib/domain/availability.ts`, čista funkcija bez pristupa bazi i mreži.

Ulaz: tajmzona, opseg datuma, radno vreme, odsustva, zauzeti intervali, trajanje
i buffer usluge, korak mreže, `now`, najraniji termin.
Izlaz: po danu, lista trenutaka u UTC.

Za svaki datum u opsegu:

1. Zidno vreme radnog intervala se prevodi u UTC preko `fromZonedTime` **za taj
   konkretan datum**. Nikad dodavanjem fiksnog pomeraja — to je jedini način da
   prelazak na letnje vreme ne pomeri termin.
2. Kandidati za početak idu od početka intervala, na svakih 15 minuta.
3. Kandidat otpada ako usluga ne staje do kraja radnog vremena. Buffer sme da
   pređe — salon radi do 20h, gel lak od 1h sa 15 minuta spremanja može da počne
   u 19h.
4. Kandidat otpada ako je ranije od `now + min_lead_minutes`.
5. Kandidat otpada ako se ceo blokirani opseg (usluga + buffer) preklapa sa
   zauzetim terminom ili odsustvom.

Mreža je usidrena za početak radnog intervala, ne za pun sat. Ako salon otvara u
09:10, prvi termin je u 09:10.

### Testovi koji moraju da postoje

- Prelazak na letnje vreme, 29. mart 2026 (02:00 → 03:00)
- Prelazak na zimsko, 25. oktobar 2026 (03:00 → 02:00): radno vreme 09:00 tog
  dana je 08:00 UTC, a dan ranije 07:00 UTC
- Termin zakazan u martu za oktobar pada na tačan sat
- Buffer koji prelazi kraj radnog vremena je dozvoljen, usluga koja prelazi nije
- Podeljena smena 09–13 i 16–20 ne nudi termin u 14h
- Odsustvo guta ceo dan
- Ista tri sata su slobodna za manikir a nisu za trepavice
- `min_lead_minutes` seče današnje jutro
- Pun dan vraća praznu listu, ne grešku

## Migracije

**A — podešavanja zakazivanja**

```
tenants += booking_horizon_days   smallint not null default 14   (1..90)
tenants += min_lead_minutes       integer  not null default 120  (0..10080)
tenants += public_booking_enabled boolean  not null default true
```

**B — audit log kroz bazu, ne kroz disciplinu u kodu**

Pravilo 4 kaže „bez izuzetka". Dogovor u aplikacionom kodu se prekrši prvi put
kad neko doda novu putanju i zaboravi. Zato triger na `appointments` upisuje red
u `appointment_events` na svaki upis i na svaku promenu statusa. Akter i uređaj
se prenose kroz `set_config` unutar funkcije koja radi izmenu, pa promena
statusa uvek ide kroz `change_appointment_status(...)`, nikad kroz direktan
`update`.

**C — javne funkcije**

`public_booking_data` i `public_book`, sa `revoke ... from public` pa
`grant execute ... to anon`.

## Redosled commit-ova

**Blok 2A — motor i javna stranica**

1. `lib/domain/phone.ts` — 060/+381 u E.164, čista funkcija + testovi
2. `lib/domain/availability.ts` + testovi iz spiska gore
3. Migracija A: podešavanja zakazivanja na `tenants`
4. Migracija B: audit triger + `change_appointment_status`, sa db testovima
5. Migracija C: `public_booking_data` i `public_book`, sa db testovima da
   anonimac **ne** može da čita `clients` ni `appointments` direktno
6. `app/(public)/[tenantSlug]/` — usluga → dan → sat → ime i telefon → potvrda

**Blok 2B — kontrola vlasnice**

7. Dnevni pregled kao podrazumevani na telefonu, sa terminima
8. Ručni unos termina: tap na slobodan slot → ime, telefon, usluga
9. Promena statusa iz dnevnog pregleda: došla / nije došla / otkaži
10. Podešavanja: radno vreme sa pauzama, horizont, najraniji termin, „ne radim"
    za dan ili opseg
11. Playwright: klijent rezerviše javno, vlasnica to vidi u kalendaru

Blok 2A sam nije upotrebljiv u salonu — zbog razloga iz „Vlasnica mora sama da
unosi termine". Pilot kreće tek kad oba bloka legnu.

## Izgled

Javna stranica **nije tabela**. Na telefonu od 375px mreža od sedam kolona daje
kolone od 45px u koje ne staje ništa. Klijent bira u tri tapa: lista usluga sa
cenom i trajanjem, horizontalna traka dana koja pokazuje samo dane sa slobodnim
mestom za tu uslugu, pa slobodni sati kao dugmići.

Ako salon ima jednog izvođača, korak sa izborom izvođača se preskače potpuno.

Za vlasnicu, dnevni pregled kao lista je na telefonu čitljiviji od nedeljne
mreže. Nedeljna mreža iz Faze 0 ostaje za tablet i desktop.

Svi novi tekstovi idu u `lib/i18n/sr.ts`, nijedan u komponentu.

## Skaliranje na više salona

Jedna baza, jedan Postgres, izolacija kroz RLS. Nije baza po salonu — to bi
značilo migraciju puta broj salona pri svakoj izmeni.

Šta postoji: `memberships` sa rolama `owner` i `staff`, RLS koji vezuje sve za
članstvo, ruta `[tenantSlug]`.

Šta Faza 2 radi za ekspanziju, i to je namerno malo:

1. Tenant se nikad ne hardkoduje — razrešava se iz slug-a, na jednom mestu. Kad
   kasnije dođe `milica.zakazi.rs`, menja se ta jedna funkcija.
2. Javna stranica ide preko `[tenantSlug]` od prvog dana, iako imamo jedan salon.

Boja, logo, pozivnice za nove vlasnike, custom domeni i super-admin ne ulaze
sada. Arhitektura ih ne blokira i to je dovoljno — ostalo je pisanje koda za
budućnost.

## Otvorena pitanja za kasnije

- **Fragmentacija.** Manikir od 45 minuta sa 10 minuta buffera završava u 09:55,
  a sledeći termin na mreži je tek u 10:00. Kod dužih usluga ta rupa raste. Kad
  budemo imali podatke, vredi probati da se pored mreže nudi i tačan trenutak kad
  se prethodni termin završi.
- **Zakazivanje u ime druge osobe.** `clients` ima jedinstven telefon po salonu,
  pa ćerka koja zakazuje majci sa svog broja pravi zabunu.
- **Šta kad vlasnica smanji radno vreme preko već zakazanog termina.** Baza to
  dozvoljava. Treba upozorenje, ne zabrana.
- **Više izvođača.** Šema podržava, javna stranica u Fazi 2 ne pita za izvođača.
