import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const appointmentSchema = z.object({
  id: z.uuid(),
  start_at: z.string(),
  end_at: z.string(),
  status: z.enum([
    "pending",
    "confirmed",
    "completed",
    "no_show",
    "cancelled_by_client",
    "cancelled_by_salon",
  ]),
  source: z.enum(["salon", "public"]),
  price_rsd: z.number().int(),
  duration_min: z.number().int(),
  buffer_after_min: z.number().int(),
  client_name: z.string(),
  client_phone: z.string(),
  service_name: z.string(),
});

export const appointmentListSchema = z.array(appointmentSchema);

export type DashboardAppointment = z.infer<typeof appointmentSchema>;
export type AppointmentStatus = DashboardAppointment["status"];

/** Statusi koje kalendar prikazuje. Otkazan termin je oslobodio svoje vreme. */
export const LIVE_STATUSES: AppointmentStatus[] = [
  "pending",
  "confirmed",
  "completed",
  "no_show",
];

/**
 * Termini salona ulogovanog korisnika u datom rasponu. Ne filtrira po tenantu
 * — to radi RLS, i to je jedina odbrana na koju se oslanjamo.
 */
export async function getAppointmentsInRange(input: {
  from: Date;
  to: Date;
}): Promise<DashboardAppointment[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("dashboard_appointments", {
    p_from: input.from.toISOString(),
    p_to: input.to.toISOString(),
  });

  if (error) {
    throw new Error(`Čitanje termina nije uspelo: ${error.message}`);
  }

  return appointmentListSchema.parse(data);
}

const writeResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), appointment_id: z.uuid() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export type AppointmentWriteResult = z.infer<typeof writeResultSchema>;

export async function createAppointment(input: {
  serviceId: string;
  startAt: Date;
  clientName: string;
  phoneE164: string;
  deviceId: string;
}): Promise<AppointmentWriteResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_appointment", {
    p_service_id: input.serviceId,
    p_start_at: input.startAt.toISOString(),
    p_client_name: input.clientName,
    p_phone_e164: input.phoneE164,
    p_device_id: input.deviceId,
  });

  if (error) {
    throw new Error(`Upis termina nije uspeo: ${error.message}`);
  }

  return writeResultSchema.parse(data);
}
