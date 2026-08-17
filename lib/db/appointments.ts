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
