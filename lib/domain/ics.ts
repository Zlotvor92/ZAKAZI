/**
 * Termin kao kalendarski unos koji telefon klijentkinje sam ume da podseti.
 *
 * Ovo nije zamena za poruku iz salona, ali je jedini podsetnik koji ne košta
 * ništa i ne zavisi ni od kog provajdera. Za nedolaske vredi više nego što
 * izgleda: telefon je ionako uvek uz nju.
 */
export type CalendarEvent = {
  uid: string;
  startAt: Date;
  endAt: Date;
  createdAt: Date;
  title: string;
  location: string;
  description: string;
};

/** Trenutak u obliku koji standard traži: bez crtica, u UTC-u. */
function stamp(value: Date): string {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Tekst u telu unosa. Zarez, tačka-zarez i obrnuta kosa crta imaju značenje u
 * formatu, pa moraju da se pobegnu, a prelom reda se piše kao dva znaka.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Standard traži da nijedan red ne pređe 75 okteta, a nastavak počinje
 * razmakom. Srpska slova su po dva okteta, pa se prelama po oktetima a ne po
 * znacima — inače bi se slovo preseklo na pola.
 */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(line);

  if (bytes.length <= 75) {
    return line;
  }

  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  let limit = 75;

  for (const character of line) {
    const size = encoder.encode(character).length;

    if (currentBytes + size > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
      // Nastavak nosi razmak na početku, pa mu ostaje jedan oktet manje.
      limit = 74;
    }

    current += character;
    currentBytes += size;
  }

  parts.push(current);

  return parts.join("\r\n ");
}

export function buildCalendarEvent(event: CalendarEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Zakazi.rs//sr",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${stamp(event.createdAt)}`,
    `DTSTART:${stamp(event.startAt)}`,
    `DTEND:${stamp(event.endAt)}`,
    `SUMMARY:${escapeText(event.title)}`,
    `LOCATION:${escapeText(event.location)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    "STATUS:CONFIRMED",
    // Dva podsetnika: veče pre, da stigne da otkaže ako ne može, i dva sata
    // pre, da stigne da dođe.
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(event.title)}`,
    "END:VALARM",
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(event.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.map(fold).join("\r\n")}\r\n`;
}
