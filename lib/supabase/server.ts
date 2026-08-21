import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireEnv, requireUrlEnv } from "@/lib/env";
import { withClockSkewRetry } from "@/lib/supabase/clock-skew";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    requireUrlEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      // Svaki upit ka bazi prolazi ovuda, pa čekanje na zaostao sat PostgREST-a
      // stoji na jednom mestu umesto u svakoj funkciji u `lib/db/`.
      global: { fetch: withClockSkewRetry() },
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
