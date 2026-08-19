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
  client_name: z.string(),
  client_phone: z.string(),
  service_name: z.string(),
  staff_id: z.uuid(),
  staff_name: z.string(),
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

export const dashboardWeekSchema = z.object({
  tenant: z.object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    timezone: z.string(),
    booking_horizon_days: z.number().int(),
    min_lead_minutes: z.number().int(),
    public_booking_enabled: z.boolean(),
    suspended: z.boolean(),
    /** `null` kad se salonu ne naplaćuje — tada nema ni upozorenja. */
    paid_until: z.string().nullable(),
  }),
  tenants: z.array(
    z.object({ id: z.uuid(), slug: z.string(), name: z.string() }),
  ),
  today: z.string(),
  week_start: z.string(),
  blocks: z.array(
    z.object({
      weekday: z.number().int(),
      start_minute: z.number().int(),
      end_minute: z.number().int(),
      slot_minutes: z.number().int(),
    }),
  ),
  staff: z.array(z.object({ id: z.uuid(), name: z.string() })),
  appointments: appointmentListSchema,
});

export type DashboardWeek = z.infer<typeof dashboardWeekSchema>;

/**
 * Salon, radno vreme i termini jedne nedelje u jednom pozivu. Domet bira RLS.
 * `null` kad nalog nije povezan ni sa jednim salonom.
 */
export async function getDashboardWeek(
  date: string | null,
  tenantId: string | null,
): Promise<DashboardWeek | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("dashboard_week", {
    p_date: date,
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(`Čitanje kalendara nije uspelo: ${error.message}`);
  }

  return data === null ? null : dashboardWeekSchema.parse(data);
}

const writeResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), appointment_id: z.uuid() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export type AppointmentWriteResult = z.infer<typeof writeResultSchema>;

export async function createAppointment(input: {
  serviceId: string;
  startAt: Date;
  durationMin: number;
  clientName: string;
  phoneE164: string;
  deviceId: string;
  staffId: string | null;
}): Promise<AppointmentWriteResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_appointment", {
    p_service_id: input.serviceId,
    p_start_at: input.startAt.toISOString(),
    p_duration_min: input.durationMin,
    p_client_name: input.clientName,
    p_phone_e164: input.phoneE164,
    p_device_id: input.deviceId,
    p_staff_id: input.staffId,
  });

  if (error) {
    throw new Error(`Upis termina nije uspeo: ${error.message}`);
  }

  return writeResultSchema.parse(data);
}

const statusResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    from_status: z.string(),
    to_status: z.string(),
  }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export type StatusChangeResult = z.infer<typeof statusResultSchema>;

export async function setAppointmentStatus(input: {
  appointmentId: string;
  status: AppointmentStatus;
  deviceId: string;
}): Promise<StatusChangeResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("change_appointment_status", {
    p_appointment_id: input.appointmentId,
    p_status: input.status,
    p_device_id: input.deviceId,
  });

  if (error) {
    throw new Error(`Promena statusa nije uspela: ${error.message}`);
  }

  return statusResultSchema.parse(data);
}

const historyEntrySchema = z.object({
  id: z.uuid(),
  from_status: appointmentSchema.shape.status.nullable(),
  to_status: appointmentSchema.shape.status,
  actor_type: z.enum(["user", "client", "system"]),
  created_at: z.string(),
});

export type AppointmentHistoryEntry = z.infer<typeof historyEntrySchema>;

/** Prazna lista i za tuđi termin i za termin koji ne postoji — RLS bira. */
export async function getAppointmentHistory(
  appointmentId: string,
): Promise<AppointmentHistoryEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("appointment_history", {
    p_appointment_id: appointmentId,
  });

  if (error) {
    throw new Error(`Čitanje istorije termina nije uspelo: ${error.message}`);
  }

  return z.array(historyEntrySchema).parse(data);
}

const blockResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), phone_e164: z.string() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export async function blockClientOfAppointment(
  appointmentId: string,
): Promise<z.infer<typeof blockResultSchema>> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("block_appointment_client", {
    p_appointment_id: appointmentId,
    p_reason: null,
  });

  if (error) {
    throw new Error(`Blokiranje broja nije uspelo: ${error.message}`);
  }

  return blockResultSchema.parse(data);
}
