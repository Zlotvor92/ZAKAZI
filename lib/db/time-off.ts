import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const timeOffSchema = z.object({
  id: z.uuid(),
  start_at: z.string(),
  end_at: z.string(),
  reason: z.string().nullable(),
});

export type TimeOff = z.infer<typeof timeOffSchema>;

const writeResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), id: z.uuid() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export type TimeOffWriteResult = z.infer<typeof writeResultSchema>;

/** Odsustva koja tek dolaze. Prošla se ne prikazuju jer se ne mogu promeniti. */
export async function getUpcomingTimeOff(): Promise<TimeOff[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("time_off")
    .select("id, start_at, end_at, reason")
    .gte("end_at", new Date().toISOString())
    .order("start_at", { ascending: true });

  if (error) {
    throw new Error(`Čitanje odsustava nije uspelo: ${error.message}`);
  }

  return z.array(timeOffSchema).parse(data);
}

export async function addTimeOff(input: {
  startAt: Date;
  endAt: Date;
  reason: string | null;
}): Promise<TimeOffWriteResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("add_time_off", {
    p_start_at: input.startAt.toISOString(),
    p_end_at: input.endAt.toISOString(),
    p_reason: input.reason,
  });

  if (error) {
    throw new Error(`Upis odsustva nije uspeo: ${error.message}`);
  }

  return writeResultSchema.parse(data);
}

export async function removeTimeOff(id: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from("time_off").delete().eq("id", id);

  if (error) {
    throw new Error(`Brisanje odsustva nije uspelo: ${error.message}`);
  }
}
