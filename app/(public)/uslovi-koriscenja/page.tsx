import type { Metadata } from "next";
import Link from "next/link";
import { sr } from "@/lib/i18n/sr";

export const metadata: Metadata = {
  title: `Uslovi korišćenja — ${sr.app.name}`,
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

export default function TermsOfServicePage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 pb-16">
      <header className="space-y-1 pt-8 pb-2">
        <h1 className="text-2xl font-bold tracking-tight">
          Uslovi korišćenja
        </h1>
        <p className="text-muted-foreground text-xs">
          Poslednja izmena: {LAST_UPDATED}
        </p>
      </header>

      <p className="text-sm leading-relaxed">
        Ovi uslovi važe za svakog ko koristi {sr.app.name} — bilo da vodiš
        salon preko njega, bilo da preko sajta nekog salona zakazuješ ili
        otkazuješ termin. Otvaranjem naloga, odnosno zakazivanjem termina,
        prihvataš ih.
      </p>

      <div className="divide-border divide-y">
        <Section title="1. Šta je Doteraj Me">
          <p>
            {sr.app.name} je alat za zakazivanje termina namenjen solo beauty
            profesionalcima — nokat-tehničarkama, kozmetičarkama, majstorima
            za trepavice i obrve, brijačima. Vlasnica salona vodi svoj
            kalendar, radno vreme i usluge; klijentkinje preko javne stranice
            njenog salona same biraju slobodan termin.
          </p>
          <p>
            Nismo salon i ne pružamo usluge lepote — mi pravimo softver koji
            to organizuje. Za sam termin, njegovu cenu i kvalitet usluge
            odgovoran je salon, ne mi.
          </p>
        </Section>

        <Section title="2. Nalog vlasnice salona">
          <p>
            Nalog otvara isključivo vlasnik platforme, na osnovu dogovora sa
            salonom. Prijavljuješ se linkom na mejl ili preko Google naloga,
            bez lozinke koju bi trebalo da pamtiš. Odgovorna si da podaci
            koje uneseš (radno vreme, usluge, cene, kontakt) budu tačni, i da
            pristup svom nalogu ne deliš sa nekim ko ne bi trebalo da ga ima.
          </p>
        </Section>

        <Section title="3. Javno zakazivanje">
          <p>
            Zakazivanje preko sajta salona ne traži nalog. Ostavljaš svoje
            ime i pravi broj telefona — izmišljen broj se odbija, jer bi
            zauzeo termin koji ti stvarno ne treba i onemogućio nekom drugom
            da ga zakaže. Termin koji zakažeš je dogovor direktno sa salonom;
            {` ${sr.app.name}`} samo prenosi taj dogovor u njegov kalendar.
          </p>
          <p>
            Da bismo sprečili zloupotrebu, broj zakazivanja sa istog broja
            telefona, uređaja ili mreže je ograničen. Salon takođe može da
            blokira tvoj broj ako si više puta zakazala i nisi došla.
          </p>
        </Section>

        <Section title="4. Pretplata i cena">
          <p>
            {sr.app.name} je trenutno u probnom periodu — cenovnik i način
            plaćanja pretplate biće objavljeni na sajtu pre nego što postanu
            obavezujući za postojeće korisnice, uz razuman rok da se korisnica
            unapred upozna sa njima. Nikom se neće naplatiti ništa bez
            prethodnog obaveštenja.
          </p>
        </Section>

        <Section title="5. Šta ne sme">
          <ul className="list-disc space-y-1 pl-5">
            <li>Zakazivati termine botom, skriptom ili tuđim podacima.</li>
            <li>
              Pokušavati da se pristupi podacima drugog salona ili da se
              zaobiđe ograničenje zakazivanja.
            </li>
            <li>
              Koristiti platformu za bilo šta van zakazivanja usluga lepote —
              nije zamišljena kao opšti alat za rezervacije.
            </li>
          </ul>
        </Section>

        <Section title="6. Ograničenje odgovornosti">
          <p>
            {sr.app.name} se pruža „kakav jeste&rdquo;. Trudimo se da radi
            pouzdano, ali ne garantujemo da će raditi bez prekida ili grešaka.
            Nismo odgovorni za štetu nastalu zbog nedolaska klijentkinje,
            pogrešno unetih podataka od strane salona ili klijentkinje, ni za
            posrednu štetu (izgubljenu zaradu i slično) nastalu korišćenjem ili
            nemogućnošću korišćenja platforme, u meri u kojoj to zakon
            dozvoljava.
          </p>
        </Section>

        <Section title="7. Prekid korišćenja">
          <p>
            Vlasnica salona može u svakom trenutku zatražiti gašenje svog
            naloga. Nalog koji krši tačku 5, ili salon koji ne izmiri
            pretplatu kad naplata bude uvedena, može biti suspendovan — to
            gasi javno zakazivanje, ne i pristup postojećem kalendaru i
            klijentima.
          </p>
        </Section>

        <Section title="8. Izmene ovih uslova">
          <p>
            Ako izmenimo ove uslove, datum na vrhu stranice će se promeniti.
            O bitnim izmenama obavestićemo vlasnice salona i pre nego što
            stupe na snagu.
          </p>
        </Section>

        <Section title="9. Merodavno pravo">
          <p>
            Na ove uslove primenjuje se pravo Republike Srbije. Za svaki spor
            nadležan je stvarno nadležan sud u Srbiji.
          </p>
        </Section>

        <Section title="10. Kontakt">
          <p>
            Za sva pitanja u vezi sa ovim uslovima, javi se Aleksandru
            Vuletiću na{" "}
            <a href="mailto:avuletic92@gmail.com" className="underline">
              avuletic92@gmail.com
            </a>
            .
          </p>
        </Section>
      </div>

      <p className="text-muted-foreground pt-6 text-center text-xs">
        <Link
          href="/politika-privatnosti"
          className="inline-block py-3.5 underline"
        >
          {sr.legal.privacy}
        </Link>
      </p>
    </main>
  );
}
