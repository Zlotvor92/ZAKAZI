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
