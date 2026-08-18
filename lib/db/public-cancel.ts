import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Ime, boje i logo salona za stranu za otkazivanje.
 *
 * Odvojeno od `getPublicBookingData`: ono vraća `null` i kad je zakazivanje
 * ručno isključeno, a otkazivanje postojećeg termina tada i dalje mora da radi.
 */
export const salonSummarySchema = z.object({
  name: z.string(),
  slug: z.string(),
  timezone: z.string(),
  brand_background: z.string().nullable(),
  brand_primary: z.string().nullable(),
  brand_accent: z.string().nullable(),
  logo_url: z.url().nullable(),
});

export type SalonSummary = z.infer<typeof salonSummarySchema>;

export async function getSalonSummary(
  slug: string,
): Promise<SalonSummary | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("public_salon_summary", {
    p_slug: slug,
  });

  if (error) {
    throw new Error(`Čitanje podataka o salonu nije uspelo: ${error.message}`);
  }

  return data === null ? null : salonSummarySchema.parse(data);
}

const upcomingAppointmentSchema = z.object({
  id: z.uuid(),
  start_at: z.string(),
  end_at: z.string(),
  service_name: z.string(),
  price_rsd: z.number().int(),
});

export type UpcomingAppointment = z.infer<typeof upcomingAppointmentSchema>;

/**
 * Budući termini datog broja telefona u salonu. `null` kad salon ne postoji
 * ili je suspendovan; prazan niz kad salon postoji ali taj broj nema termina —
 * dve različite poruke na strani.
 */
export async function getAppointmentsForPhone(
  slug: string,
  phoneE164: string,
  networkHash: string | null,
): Promise<UpcomingAppointment[] | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("public_appointments_for_phone", {
    p_slug: slug,
    p_phone_e164: phoneE164,
    p_network_hash: networkHash,
  });

  if (error) {
    throw new Error(`Čitanje termina nije uspelo: ${error.message}`);
  }

  return data === null ? null : z.array(upcomingAppointmentSchema).parse(data);
}

const cancelResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    appointment: z.object({
      id: z.uuid(),
      tenant_id: z.uuid(),
      timezone: z.string(),
      start_at: z.string(),
      end_at: z.string(),
      client_name: z.string(),
      service_name: z.string(),
    }),
  }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export type CancelResult = z.infer<typeof cancelResultSchema>;

export async function cancelPublicAppointment(input: {
  slug: string;
  phoneE164: string;
  appointmentId: string;
  deviceId: string | null;
  networkHash: string | null;
}): Promise<CancelResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("public_cancel_appointment", {
    p_slug: input.slug,
    p_phone_e164: input.phoneE164,
    p_appointment_id: input.appointmentId,
    p_device_id: input.deviceId,
    p_network_hash: input.networkHash,
  });

  if (error) {
    throw new Error(`Otkazivanje nije uspelo: ${error.message}`);
  }

  return cancelResultSchema.parse(data);
}
