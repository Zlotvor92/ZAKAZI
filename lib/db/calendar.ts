import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const feedRowSchema = z.object({
  tenant_name: z.string(),
  timezone: z.string(),
  appointment_id: z.uuid(),
  start_at: z.string(),
  end_at: z.string(),
  service_name: z.string(),
  staff_name: z.string(),
  client_name: z.string(),
  client_phone: z.string(),
  status: z.string(),
});

export type CalendarFeedRow = z.infer<typeof feedRowSchema>;

/**
 * Termini za kalendar aplikaciju vlasnice.
 *
 * Prazan spisak znači i „token ne valja" i „nema termina" — baza ih namerno
 * ne razlikuje, pa se ni ovde ne razlikuju.
 */
export async function getCalendarFeed(
  token: string,
): Promise<CalendarFeedRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("calendar_feed", {
    p_token: token,
  });

  if (error) {
    throw new Error(`Čitanje kalendara nije uspelo: ${error.message}`);
  }

  return z.array(feedRowSchema).parse(data ?? []);
}

const tokenResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), token: z.uuid().optional() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export type CalendarTokenResult = z.infer<typeof tokenResultSchema>;

/** Uključuje kalendar ili pravi novu adresu umesto procurele. */
export async function rotateCalendarToken(
  tenantId: string,
): Promise<CalendarTokenResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("set_calendar_token", {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(`Pravljenje adrese kalendara nije uspelo: ${error.message}`);
  }

  return tokenResultSchema.parse(data);
}

export async function clearCalendarToken(
  tenantId: string,
): Promise<CalendarTokenResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("clear_calendar_token", {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(`Gašenje kalendara nije uspelo: ${error.message}`);
  }

  return tokenResultSchema.parse(data);
}
