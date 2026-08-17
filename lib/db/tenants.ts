import { createClient } from "@/lib/supabase/server";

export type Tenant = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  booking_horizon_days: number;
  min_lead_minutes: number;
  public_booking_enabled: boolean;
};

/**
 * Salon ulogovanog korisnika. Ne filtrira po korisniku — RLS to već radi, pa
 * upit vidi samo salone u kojima korisnik ima članstvo.
 */
export async function getCurrentTenant(): Promise<Tenant | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tenants")
    .select(
      "id, slug, name, timezone, booking_horizon_days, min_lead_minutes, public_booking_enabled",
    )
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Čitanje salona nije uspelo: ${error.message}`);
  }

  return data;
}

/**
 * Menja samo pravila zakazivanja. Ostale kolone su vlasnici oduzete na nivou
 * privilegija nad kolonama, pa ih ni greška ovde ne bi mogla dirnuti.
 */
export async function updateBookingSettings(input: {
  tenantId: string;
  horizonDays: number;
  minLeadMinutes: number;
  publicBookingEnabled: boolean;
}): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("tenants")
    .update({
      booking_horizon_days: input.horizonDays,
      min_lead_minutes: input.minLeadMinutes,
      public_booking_enabled: input.publicBookingEnabled,
    })
    .eq("id", input.tenantId);

  if (error) {
    throw new Error(`Upis podešavanja nije uspeo: ${error.message}`);
  }
}
