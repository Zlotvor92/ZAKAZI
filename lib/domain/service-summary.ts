import { pluralize } from "@/lib/domain/plural";
import { sr } from "@/lib/i18n/sr";

export type SummarizedService = {
  id: string;
  name: string;
  duration_min: number;
  price_rsd: number;
  requires_service_id: string | null;
  requires_within_days: number | null;
  not_after_service_id: string | null;
  not_after_instead_service_id: string | null;
};

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) {
    return `${rest} ${sr.booking.minuteShort}`;
  }

  return rest === 0
    ? `${hours} ${sr.booking.hourShort}`
    : `${hours} ${sr.booking.hourShort} ${rest} ${sr.booking.minuteShort}`;
}

/** „1 h 30 min · 2.200 RSD"; bez cene samo trajanje — „0 RSD" liči na grešku. */
export function serviceLine(service: SummarizedService): string {
  const duration = formatDuration(service.duration_min);

  if (service.price_rsd === 0) {
    return duration;
  }

  const price = new Intl.NumberFormat("sr-RS").format(service.price_rsd);
  return `${duration} · ${price} ${sr.booking.currency}`;
}

/**
 * Pravila usluge kao kratke rečenice za spisak, da se bez otvaranja vidi
 * koja usluga šta traži. Pravilo koje pokazuje na uslugu koje više nema u
 * spisku ne važi (baza ga tada ne primenjuje), pa se ni ne navodi.
 */
export function serviceRules(
  service: SummarizedService,
  all: readonly SummarizedService[],
): string[] {
  const name = (id: string | null) =>
    id === null ? undefined : all.find((other) => other.id === id)?.name;
  const rules: string[] = [];

  const windowService = name(service.requires_service_id);
  if (windowService !== undefined && service.requires_within_days !== null) {
    rules.push(
      sr.settings.serviceRuleWindow
        .replace(
          "{dana}",
          `${service.requires_within_days} ${pluralize(service.requires_within_days, sr.settings.serviceRuleDays)}`,
        )
        .replace("{usluga}", windowService),
    );
  }

  const blocking = name(service.not_after_service_id);
  const instead = name(service.not_after_instead_service_id);
  if (blocking !== undefined && instead !== undefined) {
    rules.push(
      sr.settings.serviceRuleNotAfter
        .replace("{posle}", blocking)
        .replace("{umesto}", instead),
    );
  }

  return rules;
}
