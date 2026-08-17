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

/**
 * Pravi nalog za vlasnicu salona, ili vraća postojeći.
 *
 * Nalozi se ne prave iz SQL-a: upis u `auth.users` zaobilazi Supabase-ove
 * tokove za potvrdu mejla i prijavu, pa nalog izgleda ispravno dok se ne
 * pokuša prijava. Registracija je zatvorena, pa je ovo jedini put unutra.
 */
export async function ensureUser(email: string): Promise<boolean> {
  const supabase = createAdminClient();

  const { error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  if (!error) {
    return true;
  }

  // Nalog koji već postoji nije greška — vlasnica može da vodi dva salona.
  return error.code === "email_exists";
}
