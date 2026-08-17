import { z } from "zod";
import type { WorkingBlock } from "@/lib/domain/availability";
import { timeToMinutes } from "@/lib/domain/calendar";
import { createClient } from "@/lib/supabase/server";

const rowSchema = z.object({
  weekday: z.number().int(),
  start_time: z.string(),
  end_time: z.string(),
  slot_minutes: z.number().int(),
});

/**
 * Radno vreme salona ulogovanog korisnika. Ne filtrira po tenantu — to radi
 * RLS politika, pa upit vidi samo redove salona u kojima korisnik ima članstvo.
 */
export async function getWorkingBlocks(): Promise<WorkingBlock[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("working_hours")
    .select("weekday, start_time, end_time, slot_minutes")
    .order("weekday", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error(`Čitanje radnog vremena nije uspelo: ${error.message}`);
  }

  return z
    .array(rowSchema)
    .parse(data)
    .map((row) => ({
      weekday: row.weekday,
      startMinute: timeToMinutes(row.start_time),
      endMinute: timeToMinutes(row.end_time),
      slotMinutes: row.slot_minutes,
    }));
}

const writeResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export type WorkingHoursWriteResult = z.infer<typeof writeResultSchema>;

/** Upisuje celu nedelju odjednom; stara se briše u istoj transakciji. */
export async function setWorkingBlocks(
  blocks: WorkingBlock[],
): Promise<WorkingHoursWriteResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("set_working_hours", {
    p_blocks: blocks.map((block) => ({
      weekday: block.weekday,
      start_minute: block.startMinute,
      end_minute: block.endMinute,
      slot_minutes: block.slotMinutes,
    })),
  });

  if (error) {
    throw new Error(`Upis radnog vremena nije uspeo: ${error.message}`);
  }

  return writeResultSchema.parse(data);
}
