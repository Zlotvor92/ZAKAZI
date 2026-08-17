import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Baza vraća `jsonb`, pa Supabase klijent nema šta da tipizuje. Zod je ovde
 * jedina granica koja stvarno proverava šta je stiglo.
 */
export const bookingDataSchema = z.object({
  tenant: z.object({
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
    min_lead_minutes: z.number().int(),
    brand_background: z.string().nullable(),
    brand_primary: z.string().nullable(),
    brand_accent: z.string().nullable(),
  }),
  now: z.string(),
  from_date: z.string(),
  to_date: z.string(),
  services: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      duration_min: z.number().int(),
      price_rsd: z.number().int(),
    }),
  ),
  blocks: z.array(
    z.object({
      weekday: z.number().int(),
      start_minute: z.number().int(),
      end_minute: z.number().int(),
      slot_minutes: z.number().int(),
    }),
  ),
  busy: z.array(
    z.object({
      start_at: z.string(),
      end_at: z.string(),
    }),
  ),
});

export const bookResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    appointment: z.object({
      id: z.uuid(),
      start_at: z.string(),
      end_at: z.string(),
      service_name: z.string(),
      price_rsd: z.number().int(),
    }),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.string(),
  }),
]);

export type PublicBookingData = z.infer<typeof bookingDataSchema>;
export type PublicService = PublicBookingData["services"][number];
export type BookResult = z.infer<typeof bookResultSchema>;

/** Sve što javnoj stranici treba, u jednom pozivu. `null` kad salona nema. */
export async function getPublicBookingData(
  slug: string,
): Promise<PublicBookingData | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("public_booking_data", {
    p_slug: slug,
  });

  if (error) {
    throw new Error(`Čitanje javnih podataka salona nije uspelo: ${error.message}`);
  }

  if (data === null) {
    return null;
  }

  return bookingDataSchema.parse(data);
}

export async function bookPublicAppointment(input: {
  slug: string;
  serviceId: string;
  startAt: string;
  clientName: string;
  phoneE164: string;
  deviceId: string | null;
}): Promise<BookResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("public_book", {
    p_slug: input.slug,
    p_service_id: input.serviceId,
    p_start_at: input.startAt,
    p_client_name: input.clientName,
    p_phone_e164: input.phoneE164,
    p_device_id: input.deviceId,
  });

  if (error) {
    throw new Error(`Zakazivanje nije uspelo: ${error.message}`);
  }

  return bookResultSchema.parse(data);
}
