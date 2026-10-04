import type { Metadata } from "next";
import Link from "next/link";
import { display } from "@/app/fonts";
import { sr } from "@/lib/i18n/sr";

export const metadata: Metadata = {
  title: sr.blog.metaTitle,
  description: sr.blog.metaDescription,
  alternates: { canonical: "/blog" },
  openGraph: {
    type: "website",
    siteName: sr.app.name,
    title: sr.blog.metaTitle,
    description: sr.blog.metaDescription,
    locale: "sr_RS",
  },
};

export default function BlogIndexPage() {
  return (
    <div className="min-h-dvh bg-[#FBF7F0] text-[#211D1A]">
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-7 px-6 pb-8">
        <header className="flex h-[62px] items-center justify-between border-b border-[#DED5C7]">
          <Link href="/" className={`${display.className} text-xl`}>
            {sr.app.name}
          </Link>
          <span className="text-xs font-bold tracking-[0.14em] text-[#8C1D3F] uppercase">
            {sr.blog.navLabel}
          </span>
        </header>

        <section className="flex flex-col gap-3">
          <h1
            className={`${display.className} text-[40px] leading-[1.05] tracking-[-0.02em]`}
          >
            {sr.blog.title}
          </h1>
          <span className="h-0.5 w-14 bg-[#211D1A]" />
          <p className="text-[15px] leading-relaxed text-[#554C44]">
            {sr.blog.intro}
          </p>
        </section>

        <ul className="flex flex-col border-t border-[#DED5C7]">
          {Object.entries(sr.blog.posts).map(([slug, post]) => (
            <li key={slug} className="border-b border-[#DED5C7]">
              <Link
                href={`/blog/${slug}`}
                className="flex flex-col gap-1.5 py-5"
              >
                <span className="text-[10.5px] font-bold tracking-[0.18em] text-[#6B6055] uppercase">
                  {post.dateLabel} · {post.readMin} {sr.blog.readMinutes}
                </span>
                <h2 className={`${display.className} text-[22px] leading-snug`}>
                  {post.title}
                </h2>
                <p className="text-[13.5px] leading-relaxed text-[#554C44]">
                  {post.description}
                </p>
              </Link>
            </li>
          ))}
        </ul>

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
