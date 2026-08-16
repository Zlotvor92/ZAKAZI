import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Nedostaje promenljiva okruženja ${name}`);
  }
  return value;
}

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server komponente ne smeju da pišu kolačiće; osvežavanje sesije
            // radi middleware, pa je ovo bezbedno progutati.
          }
        },
      },
    },
  );
}
