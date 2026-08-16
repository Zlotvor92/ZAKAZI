import { createClient } from "@/lib/supabase/server";

export type Tenant = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
};

/**
 * Salon ulogovanog korisnika. Ne filtrira po korisniku — RLS to već radi, pa
 * upit vidi samo salone u kojima korisnik ima članstvo.
 */
export async function getCurrentTenant(): Promise<Tenant | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tenants")
    .select("id, slug, name, timezone")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Čitanje salona nije uspelo: ${error.message}`);
  }

  return data;
}
