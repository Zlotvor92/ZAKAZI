import type { Metadata } from "next";
import Link from "next/link";
import { sr } from "@/lib/i18n/sr";

export const metadata: Metadata = {
  title: `Politika privatnosti — ${sr.app.name}`,
};

const LAST_UPDATED = "18. avgust 2026.";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 py-4">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="text-muted-foreground space-y-2 text-sm leading-relaxed">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 pb-16">
      <header className="space-y-1 pt-8 pb-2">
        <h1 className="text-2xl font-bold tracking-tight">
          Politika privatnosti
        </h1>
        <p className="text-muted-foreground text-xs">
          Poslednja izmena: {LAST_UPDATED}
        </p>
      </header>

      <p className="text-sm leading-relaxed">
        Ova politika objašnjava koje podatke {sr.app.name} prikuplja, zašto,
        koliko dugo ih čuva i koja prava imaš u vezi sa njima — bilo da si
        vlasnica salona koja koristi aplikaciju, bilo da si klijentkinja koja
        preko nje zakazuje termin. Pisana je da se razume bez pravničkog
        rečnika, u skladu sa Zakonom o zaštiti podataka o ličnosti
        („Sl. glasnik RS&rdquo;, br. 87/2018).
      </p>

      <div className="divide-border divide-y">
        <Section title="1. Ko je rukovalac podataka">
          <p>
            Rukovalac podataka je Aleksandar Vuletić. Za sva pitanja o
            privatnosti i ostvarivanje prava opisanih ovde, možeš nam se
            javiti na{" "}
            <a href="mailto:avuletic92@gmail.com" className="underline">
              avuletic92@gmail.com
            </a>
            .
          </p>
          <p>
            Kad zakazuješ termin preko javne stranice salona, salon je taj koji
            odlučuje kako se tvoji podaci koriste u svom poslovanju — on je
            rukovalac tvojih podataka kao klijentkinje, a {sr.app.name} mu
            pruža tehničku platformu preko koje to radi (obrađivač). Ovaj
            dokument opisuje kako {sr.app.name} tehnički obrađuje podatke u
            oba slučaja.
          </p>
        </Section>

        <Section title="2. Koje podatke prikupljamo">
          <p>
            <span className="text-foreground font-medium">
              Ako si vlasnica salona:
            </span>{" "}
            mejl adresu kojom se prijavljuješ (i podatke sa Google naloga ako
            se prijaviš preko njega), ime salona i adresu za zakazivanje koju
            izabereš, radno vreme i usluge koje uneseš, i podatke o tvojim
            klijentkinjama koje uneseš ili koje stignu preko javnog
            zakazivanja.
          </p>
          <p>
            <span className="text-foreground font-medium">
              Ako zakazuješ termin preko sajta salona:
            </span>{" "}
            ime i prezime i broj telefona koje upišeš u formu. Ne tražimo
            mejl, adresu stanovanja ni bilo šta van onoga što je potrebno da
            salon zna ko dolazi i kako da te pozove.
          </p>
          <p>
            <span className="text-foreground font-medium">
              Automatski, u pozadini:
            </span>{" "}
            nasumičan identifikator uređaja (kolačić, bez ijednog podatka o
            tebi) i heširanu, zasoljenu oznaku mreže sa koje je zakazano — ne
            čuvamo tvoju IP adresu, samo njen nepovratni heš, i to isključivo
            da bismo prepoznali kad neko zloupotrebljava zakazivanje
            (skriptom pravi lažne termine). Ovi podaci se ne mogu vratiti na
            tvoju pravu adresu ni uređaj.
          </p>
        </Section>

        <Section title="3. Zašto obrađujemo ove podatke">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Da bismo omogućili zakazivanje, potvrdu i otkazivanje termina —
              izvršenje ugovora koji nastaje samim zakazivanjem.
            </li>
            <li>
              Da bi salon vodio svoj kalendar, istoriju termina i kontaktirao
              klijentkinje o njihovim terminima.
            </li>
            <li>
              Da bismo sprečili zloupotrebu — lažna zakazivanja, blokiranje
              termina skriptom, ponavljano zakazivanje bez dolaska — na osnovu
              legitimnog interesa salona i platforme da zaštite raspoloživost
              termina za sve.
            </li>
            <li>
              Da bismo poslali push obaveštenje vlasnici salona o novom
              zakazivanju ili otkazivanju, ako je za to dala pristanak sa svog
              telefona.
            </li>
          </ul>
        </Section>

        <Section title="4. Kome se podaci mogu otkriti">
          <p>
            Podaci jednog salona nikad nisu vidljivi drugom salonu — to je
            tehnički sprovedeno na nivou same baze podataka (Row Level
            Security), ne samo dogovorom u kodu.
          </p>
          <p>
            Infrastrukturu koju koristimo pružaju Supabase (baza podataka i
            prijava, hostovano u Frankfurtu, u Evropskoj uniji) i Vercel
            (isporuka same aplikacije, takođe iz Frankfurta). Oni obrađuju
            podatke isključivo po našim uputstvima, kao obrađivači, u skladu
            sa sopstvenim ugovorima i politikama privatnosti. Podatke ne
            prodajemo niti delimo sa bilo kim radi marketinga.
          </p>
        </Section>

        <Section title="5. Koliko dugo čuvamo podatke">
          <p>
            Podatke o terminima i klijentkinjama salon čuva dok aktivno koristi
            {` ${sr.app.name}`}, jer mu služe kao istorija poslovanja i, u
            slučaju spora oko otkazivanja, kao dokaz. Ako želiš da tvoji
            podaci kao klijentkinje budu obrisani, javi se direktno salonu kod
            kog si zakazivala, ili nama na kontakt iz tačke 1 — prosledićemo
            zahtev.
          </p>
        </Section>

        <Section title="6. Kolačići koje koristimo">
          <p>Ne koristimo kolačiće za praćenje ni za reklame. Samo:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="text-foreground font-medium">
                Prijava vlasnice salona
              </span>{" "}
              — kolačić koji Supabase koristi da zna da si prijavljena. Nestaje
              kad se odjaviš ili istekne.
            </li>
            <li>
              <span className="text-foreground font-medium">
                Izabrani salon
              </span>{" "}
              — pamti u kom salonu radiš, ako vodiš više od jednog.
            </li>
            <li>
              <span className="text-foreground font-medium">
                Identifikator uređaja
              </span>{" "}
              — nasumičan broj bez podataka o tebi, koristi se da poveže tvoje
              prethodne izmene termina radi istorije, i da prepozna
              ponavljano zakazivanje sa istog telefona.
            </li>
          </ul>
        </Section>

        <Section title="7. Bezbednost">
          <p>
            Sav saobraćaj ide preko šifrovane veze (HTTPS). Pristup podacima
            jednog salona je tehnički onemogućen svim ostalim salonima, bez
            obzira na grešku u kodu — to sprovodi sama baza podataka, ne samo
            aplikacija iznad nje. Svaka promena statusa termina se beleži sa
            vremenom i akterom, pa se može utvrditi ko je i kada nešto
            promenio.
          </p>
        </Section>

        <Section title="8. Tvoja prava">
          <p>
            U vezi sa svojim podacima o ličnosti, imaš pravo da:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>saznaš da li ih i koje obrađujemo, i dobiješ njihovu kopiju;</li>
            <li>zahtevaš ispravku netačnih ili dopunu nepotpunih podataka;</li>
            <li>
              zahtevaš brisanje podataka, kad za njihovo čuvanje više ne
              postoji osnov;
            </li>
            <li>
              zahtevaš ograničenje obrade ili uložiš prigovor na obradu
              zasnovanu na legitimnom interesu;
            </li>
            <li>zatražiš prenos podataka u mašinski čitljivom obliku.</li>
          </ul>
          <p>
            Zahtev možeš poslati na kontakt iz tačke 1. Odgovaramo bez
            nepotrebnog odlaganja.
          </p>
        </Section>

        <Section title="9. Pritužba Povereniku">
          <p>
            Ako smatraš da smo prekršili tvoja prava u vezi sa podacima o
            ličnosti, imaš pravo da se pritužbom obratiš:
          </p>
          <p>
            Poverenik za informacije od javnog značaja i zaštitu podataka o
            ličnosti
            <br />
            Bulevar kralja Aleksandra 15, 11000 Beograd
            <br />
            <a href="mailto:office@poverenik.rs" className="underline">
              office@poverenik.rs
            </a>{" "}
            ·{" "}
            <a href="tel:+381113408900" className="underline">
              +381 11 3408 900
            </a>
          </p>
        </Section>

        <Section title="10. Maloletna lica">
          <p>
            {sr.app.name} nije namenjen deci. Javno zakazivanje ne prikuplja
            starost, pa ako smatraš da je maloletno lice zakazalo termin u
            svoje ime bez saglasnosti roditelja, javi nam se da podatke
            uklonimo.
          </p>
        </Section>

        <Section title="11. Izmene ove politike">
          <p>
            Ako je izmenimo, datum na vrhu stranice će se promeniti. Bitne
            izmene — na primer, novi tip podataka koji prikupljamo — objavićemo
            i vidljivo na sajtu, ne samo promenom datuma.
          </p>
        </Section>
      </div>

      <p className="text-muted-foreground pt-6 text-center text-xs">
        <Link
          href="/uslovi-koriscenja"
          className="inline-block py-3.5 underline"
        >
          {sr.legal.terms}
        </Link>
      </p>
    </main>
  );
}
