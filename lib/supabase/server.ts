import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireEnv, requireUrlEnv } from "@/lib/env";
import { withDeadline } from "./deadline";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    requireUrlEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      global: { fetch: withDeadline },
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
