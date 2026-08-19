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

type EventLinesInput = CalendarEvent & { reminders: boolean };

function eventLines(event: EventLinesInput): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${stamp(event.createdAt)}`,
    `DTSTART:${stamp(event.startAt)}`,
    `DTEND:${stamp(event.endAt)}`,
    `SUMMARY:${escapeText(event.title)}`,
    `LOCATION:${escapeText(event.location)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    "STATUS:CONFIRMED",
  ];

  if (event.reminders) {
    // Dva podsetnika: veče pre, da stigne da otkaže ako ne može, i dva sata
    // pre, da stigne da dođe.
    lines.push(
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
    );
  }

  lines.push("END:VEVENT");

  return lines;
}

function wrap(lines: string[]): string {
  const all = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Doteraj Me//sr",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...lines,
    "END:VCALENDAR",
  ];

  return `${all.map(fold).join("\r\n")}\r\n`;
}

export function buildCalendarEvent(event: CalendarEvent): string {
  return wrap(eventLines({ ...event, reminders: true }));
}

/**
 * Ceo kalendar salona, za vlasnicu koja ga je zakačila na svoj telefon.
 *
 * Bez alarma, za razliku od pojedinačnog termina: dan sa deset termina bi
 * inače dao dvadeset zvonjava. Njoj treba pregled, ne budilnik — a podsetnik
 * za svaki termin ionako ima klijentkinja.
 *
 * `X-WR-CALNAME` je jedini način da kalendar aplikacija prikaže ime umesto
 * adrese, a `REFRESH-INTERVAL` je molba koliko često da povlači. Google i
 * Apple je uzimaju kao predlog, ne kao obavezu — Google ume da povlači i na
 * nekoliko sati bez obzira šta ovde piše.
 */
export function buildCalendarFeed(input: {
  name: string;
  createdAt: Date;
  events: Omit<CalendarEvent, "createdAt">[];
}): string {
  const header = [
    `X-WR-CALNAME:${escapeText(input.name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  const body = input.events.flatMap((event) =>
    eventLines({ ...event, createdAt: input.createdAt, reminders: false }),
  );

  return wrap([...header, ...body]);
}
