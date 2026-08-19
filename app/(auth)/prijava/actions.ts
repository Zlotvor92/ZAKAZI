"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sr } from "@/lib/i18n/sr";
import { createClient } from "@/lib/supabase/server";

const signInSchema = z.object({
  email: z.email(),
});

export type SignInState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "error"; message: string };

/**
 * Adresa na koju magic link vraća korisnika. Zaglavlje `origin` ume da
 * izostane, a `${null}/auth/callback` Supabase odbija kao nedozvoljen
 * redirect — zato je `host` prvi izbor, on uvek stiže.
 */
async function siteOrigin(): Promise<string> {
  const incoming = await headers();

  const host = incoming.get("host");
  if (host) {
    const protocol = incoming.get("x-forwarded-proto") ?? "https";
    return `${protocol}://${host}`;
  }

  const origin = incoming.get("origin");
  if (origin) {
    return origin;
  }

  throw new Error(
    "Ne mogu da odredim adresu sajta — nema ni host ni origin zaglavlja.",
  );
}

/**
 * Prijava preko Google naloga.
 *
 * Ne pravi nalog: registracija je isključena, pa Google prolazi samo onome
 * koga je vlasnik platforme već uneo. Google adresa mora da se poklopi sa
 * adresom naloga.
 *
 * `skipBrowserRedirect` je nužan jer poziv ide sa servera — PKCE verifikator
 * mora da završi u kolačiću koji piše ova akcija, a ne u pregledaču.
 */
export async function signInWithGoogle(): Promise<SignInState> {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${await siteOrigin()}/auth/callback`,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    console.error(
      `signInWithOAuth nije uspeo: ${error?.message ?? "nema adrese"}`,
    );
    return { status: "error", message: sr.signIn.failed };
  }

  redirect(data.url);
}

/**
 * Supabase drži HTTP zahtev otvorenim dok SMTP server ne primi poruku. Kad je
 * SMTP pogrešno podešen, ta veza visi duže nego što Vercel daje funkciji — pa
 * odgovor akcije pukne u pola, a forma bez granice greške iznad sebe sruši
 * celu stranu. Kraći rok ovde pretvara ćutanje u urednu poruku.
 */
const SEND_TIMEOUT_MS = 8_000;

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`nema odgovora za ${SEND_TIMEOUT_MS} ms`)),
        SEND_TIMEOUT_MS,
      );
    }),
  ]);
}

export async function requestMagicLink(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = signInSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { status: "error", message: sr.signIn.invalidEmail };
  }

  try {
    const supabase = await createClient();
    const redirectTo = `${await siteOrigin()}/auth/callback`;

    const { error } = await withTimeout(
      supabase.auth.signInWithOtp({
        email: parsed.data.email,
        options: {
          // Registracija je isključena u ovoj fazi; naloge pravi seed skripta.
          shouldCreateUser: false,
          emailRedirectTo: redirectTo,
        },
      }),
    );

    if (error) {
      // Korisniku namerno ide ista poruka bez obzira na razlog — inače bi se
      // sa forme moglo saznati koje adrese postoje u sistemu. Pravi razlog
      // ide u log servera.
      console.error(
        `signInWithOtp nije uspeo: ${error.message} (status ${error.status ?? "?"}), ` +
          `emailRedirectTo=${redirectTo}`,
      );
      return { status: "error", message: sr.signIn.failed };
    }
  } catch (cause) {
    console.error(`Slanje linka za prijavu je puklo: ${String(cause)}`);
    return { status: "error", message: sr.signIn.failed };
  }

  return { status: "sent" };
}
