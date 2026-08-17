import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const salonSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  suspended: z.boolean(),
  owner_email: z.string().nullable(),
  logo_url: z.url().nullable(),
  created_at: z.string(),
  services_count: z.number().int(),
  upcoming_count: z.number().int(),
  last_booking_at: z.string().nullable(),
});

export const adminSalonListSchema = z.array(salonSchema);

export type AdminSalon = z.infer<typeof salonSchema>;

/**
 * Svi saloni na platformi. Prazan spisak za svakog ko ne upravlja platformom —
 * baza to rešava, pa ovde nema provere koju bi neko mogao da zaboravi.
 */
export async function getAdminSalons(): Promise<AdminSalon[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("admin_salons");

  if (error) {
    throw new Error(`Čitanje salona nije uspelo: ${error.message}`);
  }

  return adminSalonListSchema.parse(data);
}

/** Da li ulogovani nalog upravlja platformom. */
export async function isPlatformOwner(): Promise<boolean> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("is_platform_owner");

  if (error) {
    throw new Error(`Provera prava nije uspela: ${error.message}`);
  }

  return data === true;
}

const writeResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), suspended: z.boolean() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export async function setSalonSuspended(input: {
  tenantId: string;
  suspended: boolean;
}): Promise<z.infer<typeof writeResultSchema>> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("set_tenant_suspended", {
    p_tenant_id: input.tenantId,
    p_suspended: input.suspended,
  });

  if (error) {
    throw new Error(`Promena stanja salona nije uspela: ${error.message}`);
  }

  return writeResultSchema.parse(data);
}

const createResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), id: z.uuid(), slug: z.string() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export type SalonCreateResult = z.infer<typeof createResultSchema>;

export async function createSalon(input: {
  name: string;
  slug: string;
  ownerEmail: string;
  timezone: string;
}): Promise<SalonCreateResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_tenant", {
    p_name: input.name,
    p_slug: input.slug,
    p_owner_email: input.ownerEmail,
    p_timezone: input.timezone,
  });

  if (error) {
    throw new Error(`Otvaranje salona nije uspelo: ${error.message}`);
  }

  return createResultSchema.parse(data);
}

const logoResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export async function setSalonLogo(input: {
  tenantId: string;
  logoUrl: string | null;
}): Promise<z.infer<typeof logoResultSchema>> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("set_tenant_logo", {
    p_tenant_id: input.tenantId,
    p_logo_url: input.logoUrl,
  });

  if (error) {
    throw new Error(`Upis logoa nije uspeo: ${error.message}`);
  }

  return logoResultSchema.parse(data);
}
