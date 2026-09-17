import type { Metadata } from "next";
import { Playfair_Display } from "next/font/google";
import Link from "next/link";
import { sr } from "@/lib/i18n/sr";

/**
 * Serif se učitava samo ovde, a ne u `layout.tsx`, da ga ne bi vukla nijedna
 * druga strana — jedina koja ga koristi je ova. `latin-ext` je obavezan zbog
 * č, ć, ž, š i đ, isto kao kod osnovnog fonta.
 */
const display = Playfair_Display({
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

/**
 * Naslov je golo ime aplikacije, bez dodatka posle crte.
 *
 * Google pri proveri brenda poredi „App name" iz konzole sa imenom koje nađe
 * na početnoj strani, i taj deo pada kad se stringovi ne poklapaju od reči do
 * reči. Zato ime stoji isto u naslovu, u `application-name` i u Open Graph
 * oznakama — opis ide u `description`, gde mu je i mesto.
 */
export const metadata: Metadata = {
  title: sr.app.name,
  description: sr.home.tagline,
  applicationName: sr.app.name,
  openGraph: {
    type: "website",
    siteName: sr.app.name,
    title: sr.app.name,
    description: sr.home.tagline,
    locale: "sr_RS",
  },
};

/**
 * Jedina strana platforme koju vidi neko ko nije prijavljen i ne dolazi na
 * link salona. Postoji zbog dve stvari: Google traži početnu stranu koja
 * objašnjava šta aplikacija radi pre nego što odobri brendiranje prijave, a
 * `notFound` ionako nudi „nazad na početak" — dotle je to vodilo na prijavu.
 *
 * Prijavljenu vlasnicu odavde skreće middleware, isto kao sa `/prijava`, pa
 * ova strana ostaje statična i ne pita bazu ni za šta.
 */
export default function HomePage() {
  // Boje su upisane kao heksadecimalne vrednosti, a ne kao tokeni teme, zato
  // što ova strana namerno izgleda isto i u tamnom režimu: posetilac koji je
  // prvi put vidi ne sme da dobije poluprazan tamni papir zbog podešavanja
  // svog telefona.
  return (
    <div className="min-h-dvh bg-[#FBF7F0] text-[#211D1A]">
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-7 px-6 pb-8">
        <header className="flex h-[62px] items-center justify-between border-b border-[#DED5C7]">
          <span className={`${display.className} text-xl tracking-[0.01em]`}>
            {sr.app.name}
          </span>
          <Link
            href="/prijava"
            className="flex h-11 items-center text-xs font-bold tracking-[0.14em] text-[#8C1D3F] uppercase"
          >
            {sr.signIn.title}
          </Link>
        </header>

        <section className="flex flex-col gap-4">
          <span className="text-[11px] font-bold tracking-[0.2em] text-[#8C1D3F] uppercase">
            {sr.home.eyebrow}
          </span>
          <h1
            className={`${display.className} text-[46px] leading-[1.02] tracking-[-0.022em]`}
          >
            {sr.home.headline}
            <br />
            <em className="text-[#8C1D3F] italic">
              {sr.home.headlineEmphasis}
            </em>{" "}
            {sr.home.headlineTail}
          </h1>
          <span className="h-0.5 w-14 bg-[#211D1A]" />
          <p
            className={`${display.className} text-[21px] leading-snug text-[#4A423B]`}
          >
            {sr.home.tagline}
          </p>
          <p className="text-sm leading-relaxed text-[#554C44]">
            {sr.home.intro}
          </p>
        </section>

        {/*
          Primer termina namerno nije kartica sa senkom: na magazinskoj strani
          bela kutija postaje najglasniji element i potuče i naslov i sliku.
          Ovde je to tabela činjenica — tanke linije i serifni brojevi.
        */}
        <section className="flex flex-col border-t-2 border-[#211D1A] pt-3">
          <span className="text-[10.5px] font-bold tracking-[0.18em] text-[#6B6055] uppercase">
            {sr.home.example.label}
          </span>
          <p className={`${display.className} mt-1 mb-3 text-[28px]`}>
            {sr.home.example.service}
          </p>
          <dl className="flex flex-col">
            <div className="flex items-baseline justify-between gap-4 border-t border-[#E4DAC9] py-2.5">
              <dt className="text-[10.5px] font-bold tracking-[0.18em] text-[#6B6055] uppercase">
                {sr.home.example.whenLabel}
              </dt>
              <dd className="text-right text-[13.5px] font-medium">
                {sr.home.example.when}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-[#E4DAC9] py-2.5">
              <dt className="text-[10.5px] font-bold tracking-[0.18em] text-[#6B6055] uppercase">
                {sr.home.example.clientLabel}
              </dt>
              <dd className="text-right text-[13.5px] font-medium">
                {sr.home.example.client}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-[#E4DAC9] py-2.5">
              <dt className="text-[10.5px] font-bold tracking-[0.18em] text-[#6B6055] uppercase">
                {sr.home.example.priceLabel}
              </dt>
              <dd
                className={`${display.className} text-right text-lg tabular-nums`}
              >
                {sr.home.example.price}
              </dd>
            </div>
          </dl>
          <div className="flex items-center gap-2 border-t border-[#E4DAC9] pt-3">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#1C7A4E"
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span className="text-[10.5px] font-bold tracking-[0.18em] text-[#1C7A4E] uppercase">
              {sr.home.example.status}
            </span>
          </div>
        </section>

        <div className="flex flex-col gap-2.5">
          <Link
            href="/prijava"
            className="flex h-14 items-center justify-center bg-[#211D1A] text-xs font-bold tracking-[0.18em] text-[#FBF7F0] uppercase"
          >
            {sr.home.signIn}
          </Link>
          <p className="text-center text-xs text-[#7A6F63]">
            {sr.home.signInHint}
          </p>
        </div>

        <ul className="flex flex-col gap-6 border-y border-[#DED5C7] py-6">
          {sr.home.points.map((point, index) => (
            <li key={point.title} className="flex gap-4">
              <span
                className={`${display.className} shrink-0 text-3xl leading-none text-[#8F7850] tabular-nums`}
                aria-hidden="true"
              >
                {`0${index + 1}`}
              </span>
              <div className="flex flex-col gap-1.5">
                <h2 className={`${display.className} text-lg leading-snug`}>
                  {point.title}
                </h2>
                <p className="text-[13.5px] leading-relaxed text-[#554C44]">
                  {point.body}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <section className="flex flex-col gap-2">
          <h2 className={`${display.className} text-[22px] text-[#8C1D3F] italic`}>
            {sr.home.forWhoTitle}
          </h2>
          <p className="text-[13.5px] leading-relaxed text-[#554C44]">
            {sr.home.forWho}
          </p>
        </section>

        <div className="flex items-baseline justify-between bg-[#F2EADC] px-5 py-4">
          <span className="text-[11px] font-bold tracking-[0.16em] text-[#6B6055] uppercase">
            {sr.home.priceLabel}
          </span>
          <span className={`${display.className} text-xl tabular-nums`}>
            {sr.home.price}{" "}
            <span className="font-sans text-[13px] text-[#6B6055]">
              {sr.home.pricePeriod}
            </span>
          </span>
        </div>

        {/*
          Google pre nego što odobri brendiranje prijave traži da početna strana
          „sa transparentnošću objasni svrhu zbog koje aplikacija traži podatke
          korisnika". Zato ovaj odeljak stoji ovde, a ne samo u politici
          privatnosti.
        */}
        <section className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-sm font-bold">{sr.home.dataTitle}</h2>
            <p className="text-[12.5px] leading-relaxed text-[#6B6055]">
              {sr.home.dataBody}{" "}
              <Link
                href="/politika-privatnosti"
                className="text-[#8C1D3F] underline"
              >
                {sr.home.dataMore}
              </Link>
              .
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <h2 className="text-sm font-bold">{sr.home.clientsTitle}</h2>
            <p className="text-[12.5px] leading-relaxed text-[#6B6055]">
              {sr.home.clientsBody}
            </p>
          </div>
        </section>

        <p className="mt-auto border-t border-[#DED5C7] pt-1 text-center text-xs text-[#7A6F63]">
          <Link
            href="/uslovi-koriscenja"
            className="inline-block py-3.5 underline"
          >
            {sr.legal.terms}
          </Link>{" "}
          ·{" "}
          <Link
            href="/politika-privatnosti"
            className="inline-block py-3.5 underline"
          >
            {sr.legal.privacy}
          </Link>
        </p>
      </main>
    </div>
  );
}
