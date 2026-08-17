import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireEnv, requireUrlEnv } from "@/lib/env";

/**
 * Klijent koji zaobilazi RLS.
 *
 * Postoji zbog jednog jedinog slučaja: klijentkinja koja zakazuje nije
 * ulogovana, a obaveštenje treba poslati na uređaje vlasnice — koje ta
 * klijentkinja po RLS-u ne sme ni da vidi, i s pravom.
 *
 * Sme se uvoziti isključivo iz server akcija i ruta. Nikad iz komponente, jer
 * bi ključ završio u pregledaču i sa njim cela baza.
 */
export function createAdminClient() {
  return createSupabaseClient(
    requireUrlEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
