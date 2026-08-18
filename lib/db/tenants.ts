import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type Tenant = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  booking_horizon_days: number;
  min_lead_minutes: number;
  public_booking_enabled: boolean;
  brand_background: string | null;
  brand_primary: string | null;
  brand_accent: string | null;
};

export const tenantSummaryListSchema = z.array(
  z.object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
  }),
);

export type TenantSummary = z.infer<typeof tenantSummaryListSchema>[number];

/** Saloni u kojima nalog ima članstvo, redom kojim su otvoreni. */
export async function getMyTenants(): Promise<TenantSummary[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("my_tenants");

  if (error) {
    throw new Error(`Čitanje salona nije uspelo: ${error.message}`);
  }

  return tenantSummaryListSchema.parse(data);
}

/**
 * Salon u kome se radi. Bez izabranog uzima prvi — nalog sa jednim salonom
 * tako nikad ne mora ništa da bira. Nečlanu vraća `null`, jer mu RLS traženi
 * salon uopšte ne pokaže.
 */
export async function getCurrentTenant(
  tenantId: string | null,
): Promise<Tenant | null> {
  const supabase = await createClient();

  const query = supabase
    .from("tenants")
    .select(
      "id, slug, name, timezone, booking_horizon_days, min_lead_minutes, public_booking_enabled, brand_background, brand_primary, brand_accent",
    );

  const { data, error } = await (tenantId === null
    ? query.order("created_at", { ascending: true })
    : query.eq("id", tenantId)
  )
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Čitanje salona nije uspelo: ${error.message}`);
  }

  return data;
}

const createResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), id: z.uuid(), slug: z.string() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export type TenantCreateResult = z.infer<typeof createResultSchema>;

export async function createTenant(input: {
  name: string;
  slug: string;
  timezone: string;
}): Promise<TenantCreateResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_tenant", {
    p_name: input.name,
    p_slug: input.slug,
    p_timezone: input.timezone,
  });

  if (error) {
    throw new Error(`Otvaranje salona nije uspelo: ${error.message}`);
  }

  return createResultSchema.parse(data);
}

const brandResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export type BrandSaveResult = z.infer<typeof brandResultSchema>;

/**
 * Boje idu kroz funkciju, ne kroz `update`: vlasnici je privilegija nad
 * `brand_*` kolonama oduzeta zajedno sa ostatkom tabele.
 */
export async function setTenantBrand(input: {
  tenantId: string;
  background: string | null;
  primary: string | null;
  accent: string | null;
}): Promise<BrandSaveResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("set_tenant_brand", {
    p_tenant_id: input.tenantId,
    p_background: input.background,
    p_primary: input.primary,
    p_accent: input.accent,
  });

  if (error) {
    throw new Error(`Upis boja nije uspeo: ${error.message}`);
  }

  return brandResultSchema.parse(data);
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
