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

export async function requestMagicLink(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = signInSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { status: "error", message: sr.signIn.invalidEmail };
  }

  const supabase = await createClient();
  const origin = (await headers()).get("origin");

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      // Registracija je isključena u ovoj fazi; naloge pravi seed skripta.
      shouldCreateUser: false,
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    return { status: "error", message: sr.signIn.failed };
  }

  return { status: "sent" };
}
