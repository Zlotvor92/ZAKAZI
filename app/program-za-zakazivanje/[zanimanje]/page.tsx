import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { display } from "@/app/fonts";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbJsonLd } from "@/lib/domain/seo";
import { sr } from "@/lib/i18n/sr";

type Profession = keyof typeof sr.seo.professions;
type PageProps = { params: Promise<{ zanimanje: string }> };

/** Samo ove adrese postoje; svaka druga je 404, ne prazna strana. */
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(sr.seo.professions).map((zanimanje) => ({ zanimanje }));
}

function findProfession(key: string) {
  return key in sr.seo.professions
    ? sr.seo.professions[key as Profession]
    : null;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { zanimanje } = await params;
  const page = findProfession(zanimanje);

  if (!page) {
    return {};
  }

  return {
    title: page.metaTitle,
    description: page.metaDescription,
    alternates: { canonical: `/${sr.seo.pathPrefix}/${zanimanje}` },
    openGraph: {
      type: "website",
      siteName: sr.app.name,
      title: page.metaTitle,
      description: page.metaDescription,
      locale: "sr_RS",
    },
  };
}

export default async function ProfessionPage({ params }: PageProps) {
  const { zanimanje } = await params;
  const page = findProfession(zanimanje);

  if (!page) {
    notFound();
  }

  const others = (Object.keys(sr.seo.professions) as Profession[]).filter(
    (key) => key !== zanimanje,
  );

  return (
    <div className="min-h-dvh bg-[#FBF7F0] text-[#211D1A]">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: sr.seo.crumbHome, path: "/" },
          { name: page.label, path: `/${sr.seo.pathPrefix}/${zanimanje}` },
        ])}
      />
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-7 px-6 pb-8">
        <header className="flex h-[62px] items-center justify-between border-b border-[#DED5C7]">
          <Link href="/" className={`${display.className} text-xl`}>
            {sr.app.name}
          </Link>
        </header>

        <section className="flex flex-col gap-4">
          <h1
            className={`${display.className} text-[34px] leading-[1.08] tracking-[-0.02em] text-balance`}
          >
            {page.h1}
          </h1>
          <span className="h-0.5 w-14 bg-[#211D1A]" />
          <p className="text-[15px] leading-relaxed text-[#554C44]">
            {page.intro}
          </p>
        </section>

        <ul className="flex flex-col gap-6 border-y border-[#DED5C7] py-6">
          {page.points.map((point, index) => (
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

        <section className="flex flex-col gap-3">
          <h2
            className={`${display.className} text-[22px] text-[#8C1D3F] italic`}
          >
            {sr.seo.stepsTitle}
          </h2>
          <ol className="flex flex-col gap-2 text-[13.5px] leading-relaxed text-[#554C44]">
            {sr.seo.steps.map((step, index) => (
              <li key={step}>
                <b className="text-[#211D1A]">{index + 1}.</b> {step}
              </li>
            ))}
          </ol>
        </section>

        <div className="flex flex-col gap-2 bg-[#F2EADC] px-5 py-4">
          <p className="text-[13.5px] font-medium">{sr.seo.priceLine}</p>
          <p className="text-[13.5px] leading-relaxed text-[#554C44]">
            {sr.seo.cta.before}{" "}
            <b className="font-bold tracking-[0.06em] text-[#8C1D3F]">
              {sr.seo.cta.keyword}
            </b>{" "}
            {sr.seo.cta.after}{" "}
            <a
              href={sr.seo.cta.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[#8C1D3F] underline"
            >
              {sr.seo.cta.handle}
            </a>
          </p>
        </div>

        <section className="flex flex-col gap-4">
          <h2
            className={`${display.className} text-[22px] text-[#8C1D3F] italic`}
          >
            {sr.seo.faqTitle}
          </h2>
          {sr.seo.faq.map((item) => (
            <div key={item.q} className="flex flex-col gap-1">
              <h3 className="text-sm font-bold">{item.q}</h3>
              <p className="text-[13.5px] leading-relaxed text-[#554C44]">
                {item.a}
              </p>
            </div>
          ))}
        </section>

        <nav
          aria-label={sr.seo.otherTitle}
          className="flex flex-col gap-2 border-t border-[#DED5C7] pt-4"
        >
          <span className="text-[10.5px] font-bold tracking-[0.18em] text-[#6B6055] uppercase">
            {sr.seo.otherTitle}
          </span>
          <ul className="flex flex-wrap gap-x-4">
            {others.map((key) => (
              <li key={key}>
                <Link
                  href={`/${sr.seo.pathPrefix}/${key}`}
                  className="inline-block py-2 text-[13.5px] text-[#8C1D3F] underline"
                >
                  {sr.seo.professions[key].label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

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
