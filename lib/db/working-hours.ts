import { z } from "zod";
import { timeToMinutes, type WorkingInterval } from "@/lib/domain/calendar";
import { createClient } from "@/lib/supabase/server";

/**
 * Radno vreme salona ulogovanog korisnika. Ne filtrira po tenantu — to radi
 * RLS politika, pa upit vidi samo redove salona u kojima korisnik ima članstvo.
 */
export async function getWorkingHours(): Promise<WorkingInterval[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("working_hours")
    .select("weekday, start_time, end_time")
    .order("weekday", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error(`Čitanje radnog vremena nije uspelo: ${error.message}`);
  }

  return data.map((row) => ({
    weekday: row.weekday,
    startMinute: timeToMinutes(row.start_time),
    endMinute: timeToMinutes(row.end_time),
  }));
}

const writeResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export type WorkingHoursWriteResult = z.infer<typeof writeResultSchema>;

/** Upisuje celu nedelju odjednom; stara se briše u istoj transakciji. */
export async function setWorkingHours(
  intervals: WorkingInterval[],
): Promise<WorkingHoursWriteResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("set_working_hours", {
    p_intervals: intervals.map((interval) => ({
      weekday: interval.weekday,
      start_minute: interval.startMinute,
      end_minute: interval.endMinute,
    })),
  });

  if (error) {
    throw new Error(`Upis radnog vremena nije uspeo: ${error.message}`);
  }

  return writeResultSchema.parse(data);
}
