import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const serviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  duration_min: z.number().int(),
  price_rsd: z.number().int(),
});

export const serviceListSchema = z.array(serviceSchema);

export type Service = z.infer<typeof serviceSchema>;

/** Aktivne usluge salona ulogovanog korisnika. Domet bira RLS. */
export async function getActiveServices(): Promise<Service[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("tenant_services");

  if (error) {
    throw new Error(`Čitanje usluga nije uspelo: ${error.message}`);
  }

  return serviceListSchema.parse(data);
}

const writeResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), id: z.uuid() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export type ServiceWriteResult = z.infer<typeof writeResultSchema>;

export async function saveService(input: {
  id: string | null;
  name: string;
  durationMin: number;
  priceRsd: number;
}): Promise<ServiceWriteResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("upsert_service", {
    p_id: input.id,
    p_name: input.name,
    p_duration_min: input.durationMin,
    p_price_rsd: input.priceRsd,
  });

  if (error) {
    throw new Error(`Upis usluge nije uspeo: ${error.message}`);
  }

  return writeResultSchema.parse(data);
}

const removeResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), outcome: z.enum(["deleted", "deactivated"]) }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export async function removeService(
  id: string,
): Promise<z.infer<typeof removeResultSchema>> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("remove_service", { p_id: id });

  if (error) {
    throw new Error(`Uklanjanje usluge nije uspelo: ${error.message}`);
  }

  return removeResultSchema.parse(data);
}
