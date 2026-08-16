"use server";

import { headers } from "next/headers";
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

export async function requestMagicLink(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = signInSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { status: "error", message: sr.signIn.invalidEmail };
  }

  const supabase = await createClient();
  const redirectTo = `${await siteOrigin()}/auth/callback`;

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      // Registracija je isključena u ovoj fazi; naloge pravi seed skripta.
      shouldCreateUser: false,
      emailRedirectTo: redirectTo,
    },
  });

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

  return { status: "sent" };
}
