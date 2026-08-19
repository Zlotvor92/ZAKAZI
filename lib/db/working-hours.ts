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
 * Radno vreme izabranog salona. RLS odseca tuđe salone; `tenant_id` odseca
 * druge salone iste vlasnice, koje RLS s pravom pušta.
 */
export async function getWorkingBlocks(
  tenantId: string,
  staffId: string | null,
): Promise<WorkingBlock[]> {
  const supabase = await createClient();

  // Salon bez ijedne osobe nema ni radnog vremena, pa upit bez filtera po
  // osobi svejedno vraća prazno — a prazan `staff_id` bi u Postgresu bio
  // neispravan uuid i oborio ceo ekran podešavanja.
  const rows = supabase
    .from("working_hours")
    .select("weekday, start_time, end_time, slot_minutes")
    .eq("tenant_id", tenantId);

  // Dve osobe imaju dva rasporeda; bez ovog filtera bi se prikazali oba
  // pomešana, kao da salon radi dva puta u istom danu.
  const { data, error } = await (staffId === null
    ? rows
    : rows.eq("staff_id", staffId)
  )
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
  tenantId: string | null,
  staffId: string | null,
): Promise<WorkingHoursWriteResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("set_working_hours", {
    p_blocks: blocks.map((block) => ({
      weekday: block.weekday,
      start_minute: block.startMinute,
      end_minute: block.endMinute,
      slot_minutes: block.slotMinutes,
    })),
    p_tenant_id: tenantId,
    p_staff_id: staffId,
  });

  if (error) {
    throw new Error(`Upis radnog vremena nije uspeo: ${error.message}`);
  }

  return writeResultSchema.parse(data);
}
