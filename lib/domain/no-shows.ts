import { formatInTimeZone } from "date-fns-tz";
import { sr } from "@/lib/i18n/sr";

export type PriorNoShow = { start_at: string; service_name: string };

/**
 * Linija o ranijim izostancima za obaveštenje o zakazivanju, ili `null` kad
 * ih nema.
 *
 * Bez nje vlasnica klijentkinju koja nije došla prepoznaje samo ako se seti
 * imena — a ime se pri svakom zakazivanju upisuje iznova.
 */
export function priorNoShowsLine(
  prior: { total: number; latest: PriorNoShow[] },
  timeZone: string,
): string | null {
  if (prior.total === 0) {
    return null;
  }

  const entries = prior.latest.map((entry) =>
    sr.push.priorNoShowEntry
      .replace(
        "{vreme}",
        formatInTimeZone(new Date(entry.start_at), timeZone, "dd.MM. 'u' HH:mm"),
      )
      .replace("{usluga}", entry.service_name),
  );

  return sr.push.priorNoShows
    .replace("{puta}", String(prior.total))
    .replace("{termini}", entries.join(", "));
}
