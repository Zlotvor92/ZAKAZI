import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const clientCardSchema = z.object({
  client_id: z.uuid(),
  name: z.string(),
  phone_e164: z.string(),
  notes: z.string().nullable(),
  first_seen: z.string(),
  completed: z.number().int(),
  no_show: z.number().int(),
  cancelled_by_client: z.number().int(),
  cancelled_by_salon: z.number().int(),
  upcoming: z.number().int(),
  last_visit: z.string().nullable(),
  blocked: z.boolean(),
});

export type ClientCard = z.infer<typeof clientCardSchema>;

/** Klijentkinja termina, sa zbirom svih termina sa njenog broja. */
export async function getClientCard(
  appointmentId: string,
): Promise<ClientCard | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("client_card", {
    p_appointment_id: appointmentId,
  });

  if (error) {
    throw new Error(`Čitanje kartice klijentkinje nije uspelo: ${error.message}`);
  }

  return clientCardSchema.nullable().parse(data);
}

const notesResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export async function saveClientNotes(input: {
  clientId: string;
  notes: string;
}): Promise<z.infer<typeof notesResultSchema>> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("set_client_notes", {
    p_client_id: input.clientId,
    p_notes: input.notes,
  });

  if (error) {
    throw new Error(`Upis beleške nije uspeo: ${error.message}`);
  }

  return notesResultSchema.parse(data);
}
