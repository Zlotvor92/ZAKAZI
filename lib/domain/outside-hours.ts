import { formatInTimeZone } from "date-fns-tz";
import { pluralize } from "@/lib/domain/plural";
import { sr } from "@/lib/i18n/sr";

const LISTED = 3;

/**
 * Poruka posle čuvanja radnog vremena kad već zakazani termini ostanu van
 * njega, ili `null` kad takvih nema. Navodi prva tri, da poruka ne pređe
 * ekran, i koliko ih je još.
 */
export function outsideHoursMessage(
  appointments: readonly { start_at: string; client_name: string }[],
  timeZone: string,
): string | null {
  if (appointments.length === 0) {
    return null;
  }

  const entries = appointments.slice(0, LISTED).map((appointment) => {
    const at = new Date(appointment.start_at);
    const weekday = Number(formatInTimeZone(at, timeZone, "i"));

    return sr.settings.hoursOutsideEntry
      .replace("{dan}", sr.calendar.weekdaysShort[weekday - 1]!)
      .replace("{datum}", formatInTimeZone(at, timeZone, "d.M."))
      .replace("{vreme}", formatInTimeZone(at, timeZone, "HH:mm"))
      .replace("{klijent}", appointment.client_name);
  });

  const rest = appointments.length - LISTED;
  if (rest > 0) {
    entries.push(sr.settings.hoursOutsideMore.replace("{broj}", String(rest)));
  }

  const count = appointments.length;
  return sr.settings.hoursOutside
    .replace("{ostaje}", pluralize(count, sr.settings.hoursOutsideVerb))
    .replace("{broj}", String(count))
    .replace("{termina}", pluralize(count, sr.settings.hoursOutsideNoun))
    .replace("{spisak}", entries.join(", "));
}
