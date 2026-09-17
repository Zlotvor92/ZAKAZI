import Link from "next/link";
import { display } from "@/app/fonts";
import { sr } from "@/lib/i18n/sr";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ greska?: string }>;
}) {
  const { greska } = await searchParams;

  // Boje su heksadecimalne, a ne tokeni teme, iz istog razloga kao na početnoj:
  // ove dve strane su ono što posetilac prvo vidi i namerno izgledaju isto bez
  // obzira na to da li mu je telefon u tamnom režimu.
  return (
    <div className="min-h-dvh bg-[#FBF7F0] text-[#211D1A]">
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pb-8">
        <header className="flex h-[62px] items-center border-b border-[#DED5C7]">
          <Link
            href="/"
            className={`${display.className} flex h-11 items-center text-xl tracking-[0.01em]`}
          >
            {sr.app.name}
          </Link>
        </header>

        <div className="flex flex-col gap-7 pt-10">
          <div className="flex flex-col gap-4">
            <h1
              className={`${display.className} text-[40px] leading-[1.02] tracking-[-0.022em]`}
            >
              {sr.signIn.title}
            </h1>
            <span className="h-0.5 w-14 bg-[#211D1A]" />
            <p
              className={`${display.className} text-[19px] leading-snug text-[#4A423B]`}
            >
              {sr.signIn.subtitle}
            </p>
          </div>

          {greska ? (
            <p
              role="alert"
              className="border-l-2 border-[#B3261E] pl-3 text-sm leading-relaxed text-[#B3261E]"
            >
              {greska === "google"
                ? sr.callback.googleFailed
                : sr.callback.failed}
            </p>
          ) : null}

          <SignInForm />
        </div>

        {/*
          Isti linkovi kao na početnoj: Google pri proveri prijave gleda i da
          li su uslovi i politika privatnosti dohvatljivi odatle odakle se
          korisnik prijavljuje, a ne samo sa početne strane.
        */}
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
