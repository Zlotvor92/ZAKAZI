import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const serviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  duration_min: z.number().int(),
  price_rsd: z.number().int(),
  description: z.string().nullable(),
  requires_service_id: z.uuid().nullable(),
  requires_within_days: z.number().int().nullable(),
});

export const serviceListSchema = z.array(serviceSchema);

export type Service = z.infer<typeof serviceSchema>;

/** Aktivne usluge izabranog salona. Bez izabranog — prvog po redu. */
export async function getActiveServices(
  tenantId: string | null,
): Promise<Service[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("tenant_services", {
    p_tenant_id: tenantId,
  });

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
  description: string;
  requiresServiceId: string | null;
  requiresWithinDays: number | null;
  tenantId: string | null;
}): Promise<ServiceWriteResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("upsert_service", {
    p_id: input.id,
    p_name: input.name,
    p_duration_min: input.durationMin,
    p_price_rsd: input.priceRsd,
    p_tenant_id: input.tenantId,
    p_description: input.description,
    p_requires_service_id: input.requiresServiceId,
    p_requires_within_days: input.requiresWithinDays,
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

const moveResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export async function moveService(input: {
  id: string;
  direction: "up" | "down";
  tenantId: string | null;
}): Promise<z.infer<typeof moveResultSchema>> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("move_service", {
    p_id: input.id,
    p_direction: input.direction,
    p_tenant_id: input.tenantId,
  });

  if (error) {
    throw new Error(`Pomeranje usluge nije uspelo: ${error.message}`);
  }

  return moveResultSchema.parse(data);
}

const windowProblemSchema = z
  .object({
    window_days: z.number().int(),
    required_service_name: z.string(),
    last_visit: z.string(),
  })
  .nullable();

export type ServiceWindowProblem = NonNullable<
  z.infer<typeof windowProblemSchema>
>;

/**
 * Da li usluga za ovaj broj važi tog dana, ili je od poslednjeg dolaska
 * prošlo više dana nego što pravilo usluge dozvoljava. `null` kad je u redu.
 */
export async function checkServiceWindow(input: {
  serviceId: string;
  phoneE164: string;
  tenantId: string;
  startAt: Date;
}): Promise<ServiceWindowProblem | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("service_window_problem", {
    p_service_id: input.serviceId,
    p_phone_e164: input.phoneE164,
    p_tenant_id: input.tenantId,
    p_start_at: input.startAt.toISOString(),
  });

  if (error) {
    throw new Error(`Provera roka usluge nije uspela: ${error.message}`);
  }

  return windowProblemSchema.parse(data);
}
