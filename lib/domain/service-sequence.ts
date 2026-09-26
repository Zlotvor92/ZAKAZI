import { formatInTimeZone } from "date-fns-tz";
import { sr } from "@/lib/i18n/sr";

/** Ono što `service_sequence_problem` vraća kad usluga ne ide tim redom. */
export type SequenceProblem =
  | {
      kind: "after";
      service_name: string;
      blocking_service_name: string;
      blocking_at: string;
      required_service_name: string;
    }
  | {
      kind: "before";
      service_name: string;
      later_service_name: string;
      later_at: string;
    };

/** „9. oktobar" — klijentkinja datum čita kao rečenicu, ne kao 09.10. */
function dayAndMonth(at: string, timeZone: string): string {
  const [month, day] = formatInTimeZone(new Date(at), timeZone, "M d")
    .split(" ")
    .map(Number);

  return `${day}. ${sr.calendar.months[month! - 1]}`;
}

/**
 * Poruka o redosledu usluga, sastavljena od naziva koje je salon dao, pa je
 * tačna za svaki salon bez ikakvog podešavanja teksta.
 */
export function sequenceMessage(
  problem: SequenceProblem,
  timeZone: string,
  audience: "client" | "owner",
): string {
  const texts =
    audience === "client" ? sr.booking.serviceSequence : sr.newAppointment.serviceSequence;

  if (problem.kind === "after") {
    return texts.after
      .replace("{usluga}", problem.service_name)
      .replace("{prepreka}", problem.blocking_service_name)
      .replace("{datum}", dayAndMonth(problem.blocking_at, timeZone))
      .replace("{potrebna}", problem.required_service_name);
  }

  return texts.before
    .replace("{kasnija}", problem.later_service_name)
    .replace("{datum}", dayAndMonth(problem.later_at, timeZone))
    .replace("{usluga}", problem.service_name);
}
