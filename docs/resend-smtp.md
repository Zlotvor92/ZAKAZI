# Slanje mejlova preko Resend-a

Mejl u ovom projektu služi samo za jednu stvar: **magic link za prijavu**
(`app/(auth)/prijava/actions.ts` → `supabase.auth.signInWithOtp`). Nema
newsletter-a, nema podsetnika mejlom — podsetnici idu preko push-a
(`lib/messaging/push.ts`).

Supabase-ov ugrađeni mejl servis šalje **2 poruke na sat po projektu** i u
dokumentaciji je izričito označen kao „samo za testiranje". Kad se troje ljudi
prijavi u istom satu, četvrti ne dobije link. Zato se ispod Supabase Auth-a
podmeće Resend kao SMTP server.

## Šta se menja u kodu

**Ništa.** Supabase i dalje pravi token, šablon i link; menja se samo kojim
serverom poruka izlazi. Ne uvodi se nova biblioteka, nema novog env vara u
aplikaciji, `signInWithOtp` i `/auth/callback` ostaju isti.

Resend besplatni plan: **3.000 mejlova mesečno, 100 dnevno, 1 domen**,
30 dana zadržavanja logova. Za prijave u salon to je višestruko dovoljno.

---

## Korak 1 — nalog i domen na Resend-u

1. Otvori nalog na https://resend.com (besplatan plan, bez kartice).
2. **Domains → Add Domain**, unesi domen sa kog šalješ (npr. `doteraj.me`).
   Preporuka je poddomen za slanje, npr. `mail.doteraj.me` — tako reputacija
   slanja ne dira glavni domen ako nešto pođe naopako.
3. Resend ispiše DNS zapise. Dodaj ih kod registrara / u Vercel DNS:
   - `MX` zapis (za povratne poruke)
   - `TXT` sa SPF-om
   - `TXT` sa DKIM ključem
4. Klikni **Verify**. Propagacija ide od par minuta do sat vremena.
   Status mora biti **Verified** pre nego što se ide dalje.

> Bez verifikovanog domena Resend dozvoljava slanje samo sa
> `onboarding@resend.dev` i **isključivo na adresu kojom si otvorio nalog**.
> To služi za probu, ne za rad — vlasnice salona ne bi dobile ništa.

Opciono, ali preporučeno posle prvih uspešnih slanja: dodaj `DMARC` TXT zapis
na `_dmarc.doteraj.me` sa `v=DMARC1; p=none; rua=mailto:...`, da vidiš izveštaje.

## Korak 2 — API ključ

1. **API Keys → Create API Key**.
2. Ime: `supabase-auth`. Dozvola: **Sending access**. Domen: onaj verifikovani.
3. Kopiraj ključ (`re_...`) — prikazuje se samo jednom.

Ključ ide **samo u Supabase konzolu**, nikad u repozitorijum, nikad u
`.env.local`, nikad u `NEXT_PUBLIC_` promenljivu.

## Korak 3 — Supabase: Custom SMTP

U Supabase konzoli, na produkcijskom projektu:

**Project Settings → Authentication → SMTP Settings → Enable Custom SMTP**

| Polje | Vrednost |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | Resend API ključ (`re_...`) |
| Sender email | `prijava@doteraj.me` (adresa na verifikovanom domenu) |
| Sender name | `Doteraj Me` |

Port `465` je implicitni TLS i radi bez dodatnog podešavanja. Alternative su
`587` i `2587` (STARTTLS) ako bi 465 negde bio blokiran. Port `25` ne koristi —
Supabase ga odbija.

Sačuvaj.

## Korak 4 — podigni ograničenje slanja

Custom SMTP **ne diže sam** Supabase-ovo ograničenje. Ono se menja posebno:

**Authentication → Rate Limits → „Rate limit for sending emails"**

Podrazumevano je 30 na sat čim se uključi custom SMTP. Postavi na realnu
vrednost — npr. **100 na sat**. Gornja granica ostaje Resend-ovih 100 dnevno,
pa nema smisla ići mnogo preko toga.

Proveri i **„Rate limit for OTP"** ako ista osoba često traži novi link.

## Korak 5 — proveri da radi

1. Otvori `/prijava` na produkciji, upiši mejl vlasnice koja postoji u bazi.
2. Poruka mora stići za nekoliko sekundi.
3. U Resend-u, **Emails**, poruka je u listi sa statusom `Delivered`.
4. Klikni link iz mejla → mora te odvesti na `/dashboard` sa sesijom.
5. Uradi to **pet puta u istom satu** sa različitih adresa. Ranije bi treći
   pokušaj pao; sada moraju proći svi.

Ako mejl ne stigne:
- Resend → **Emails**: ako poruke nema, Supabase nije ni pokušao — greška je u
  SMTP podešavanjima ili u tome što nalog ne postoji (`shouldCreateUser: false`).
- Ako poruka postoji sa `Bounced` / `Complained`, problem je u DNS zapisima.
- Supabase → **Logs → Auth Logs** pokazuje odbijanje SMTP servera doslovno.

---

## Lokalni razvoj se ne dira

Lokalno poruke i dalje hvata Supabase-ov sandučić na
`http://127.0.0.1:54324` (`[local_smtp]` u `supabase/config.toml`). To je
namerno: razvoj ne troši dnevnu kvotu i ne šalje ništa na internet.

Ako ti ikad zatreba da lokalno stvarno pošalješ mejl, dodaj u `config.toml`:

```toml
[auth.email.smtp]
enabled = true
host = "smtp.resend.com"
port = 465
user = "resend"
pass = "env(RESEND_API_KEY)"
admin_email = "prijava@doteraj.me"
sender_name = "Doteraj Me"
```

i drži `RESEND_API_KEY` u `.env.local`, koji je u `.gitignore`. Vrati na
`enabled = false` čim završiš.

---

## Opciono — šablon mejla na srpskom

Supabase-ov podrazumevani šablon je na engleskom. **Authentication → Email
Templates → Magic Link**:

```html
<h2>Prijava na Doteraj Me</h2>
<p>Klikni na dugme da uđeš u svoj kalendar. Link važi 1 sat.</p>
<p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=magiclink">Uđi u kalendar</a></p>
<p>Ako nisi ti tražio/la prijavu, samo obriši ovu poruku.</p>
```

Oblik sa `token_hash` je namerno izabran umesto `{{ .ConfirmationURL }}`:
`ConfirmationURL` nosi PKCE kod koji važi samo u pregledaču koji je prijavu i
započeo, pa puca kad korisnica otvori mejl na telefonu a prijavu započela na
računaru — ili kad mejl klijent unapred „poseti" link i potroši ga.
Ruta `app/auth/callback/route.ts` već ume oba oblika, pa ova izmena ne traži
nikakvu promenu koda.

`{{ .SiteURL }}` mora biti podešen na produkcijski domen pod
**Authentication → URL Configuration**, zajedno sa `/auth/callback` u
dozvoljenim adresama za povratak.

---

## Zašto ne Resend API direktno iz aplikacije

Postojala bi i varijanta: `supabase.auth.admin.generateLink()` u server akciji,
pa slanje kroz `resend` npm paket. Odbačeno jer:

- traži `SUPABASE_SERVICE_ROLE_KEY` u aplikaciji zbog prijave, a taj ključ
  zaobilazi RLS i treba da ostane na što manje mesta
- gubi se Supabase-ovo ograničenje broja pokušaja po adresi, pa bi se
  moralo pisati ručno
- uvodi novu biblioteku i novi kod koji može da pukne, za istu poruku

Ako jednog dana zatreba mejl koji Supabase ne šalje (račun za pretplatu,
izveštaj), tada se uvodi `resend` paket i `lib/messaging/email.ts` — i tada se
svako slanje loguje u `messages` tabelu, kao što traži `CLAUDE.md`.
