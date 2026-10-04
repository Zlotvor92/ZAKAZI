import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { display } from "@/app/fonts";
import { JsonLd } from "@/components/json-ld";
import { articleJsonLd, breadcrumbJsonLd } from "@/lib/domain/seo";
import { sr } from "@/lib/i18n/sr";

type PostKey = keyof typeof sr.blog.posts;
type PageProps = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(sr.blog.posts).map((slug) => ({ slug }));
}

function findPost(slug: string) {
  return slug in sr.blog.posts ? sr.blog.posts[slug as PostKey] : null;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = findPost(slug);

  if (!post) {
    return {};
  }

  return {
    title: post.metaTitle,
    description: post.description,
    alternates: { canonical: `/blog/${slug}` },
    openGraph: {
      type: "article",
      siteName: sr.app.name,
      title: post.metaTitle,
      description: post.description,
      locale: "sr_RS",
      publishedTime: post.dateIso,
    },
  };
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = findPost(slug);

  if (!post) {
    notFound();
  }

  return (
    <div className="min-h-dvh bg-[#FBF7F0] text-[#211D1A]">
      <JsonLd
        data={[
          articleJsonLd({
            title: post.title,
            description: post.description,
            path: `/blog/${slug}`,
            dateIso: post.dateIso,
            publisherName: sr.app.name,
          }),
          breadcrumbJsonLd([
            { name: sr.seo.crumbHome, path: "/" },
            { name: sr.blog.title, path: "/blog" },
            { name: post.title, path: `/blog/${slug}` },
          ]),
        ]}
      />
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-7 px-6 pb-8">
        <header className="flex h-[62px] items-center justify-between border-b border-[#DED5C7]">
          <Link href="/" className={`${display.className} text-xl`}>
            {sr.app.name}
          </Link>
          <Link
            href="/blog"
            className="flex h-11 items-center text-xs font-bold tracking-[0.14em] text-[#6B6055] uppercase"
          >
            {sr.blog.navLabel}
          </Link>
        </header>

        <article className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <span className="text-[10.5px] font-bold tracking-[0.18em] text-[#6B6055] uppercase">
              {post.dateLabel} · {post.readMin} {sr.blog.readMinutes}
            </span>
            <h1
              className={`${display.className} text-[32px] leading-[1.1] tracking-[-0.02em] text-balance`}
            >
              {post.title}
            </h1>
            <span className="h-0.5 w-14 bg-[#211D1A]" />
            <p className="text-[15px] leading-relaxed text-[#554C44]">
              {post.intro}
            </p>
          </div>

          {post.sections.map((section) => (
            <section key={section.heading} className="flex flex-col gap-2">
              <h2 className={`${display.className} text-[21px] leading-snug`}>
                {section.heading}
              </h2>
              {section.paragraphs.map((paragraph) => (
                <p
                  key={paragraph}
                  className="text-[14.5px] leading-relaxed text-[#554C44]"
                >
                  {paragraph}
                </p>
              ))}
            </section>
          ))}

          <p className="text-[14.5px] leading-relaxed text-[#554C44]">
            {post.closing}
          </p>
        </article>

        <div className="flex flex-col gap-2 bg-[#F2EADC] px-5 py-4">
          <p className="text-sm font-bold">{sr.blog.ctaTitle}</p>
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

        <Link
          href="/blog"
          className="inline-block py-2 text-[13.5px] text-[#8C1D3F] underline"
        >
          ← {sr.blog.back}
        </Link>

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
