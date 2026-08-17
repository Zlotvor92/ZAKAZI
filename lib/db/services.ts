import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const serviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  duration_min: z.number().int(),
  buffer_after_min: z.number().int(),
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
