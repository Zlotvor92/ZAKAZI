import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
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
  /** Manje od 24 sata do početka: otkazivanje se računa kao kasno. */
  late: z.boolean(),
});

export type UpcomingAppointment = z.infer<typeof upcomingAppointmentSchema>;

/** Phone matching is scoped to the salon; cookies and links are not required. */
export async function getAppointmentsForPhone(input: {
  slug: string;
  phoneE164: string;
}): Promise<UpcomingAppointment[] | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("public_appointments_for_proof", {
    p_slug: input.slug,
    p_phone_e164: input.phoneE164,
    p_secrets: [],
    p_device_id: null,
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
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("public_cancel_appointment", {
    p_slug: input.slug,
    p_phone_e164: input.phoneE164,
    p_appointment_id: input.appointmentId,
    p_secrets: [],
    p_device_id: input.deviceId,
    p_network_hash: input.networkHash,
  });

  if (error) {
    throw new Error(`Otkazivanje nije uspelo: ${error.message}`);
  }

  return cancelResultSchema.parse(data);
}

/**
 * Briše pokušaje pretrage starije od dana i vraća koliko ih je otišlo. Limit
 * gleda samo poslednjih 60 minuta, pa stariji zapisi nikome ne trebaju.
 */
export async function prunePhoneLookupAttempts(): Promise<number> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("prune_phone_lookup_attempts");

  if (error) {
    throw new Error(`Čišćenje pokušaja pretrage nije uspelo: ${error.message}`);
  }

  return z.number().int().parse(data);
}
