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

type EventLinesInput = CalendarEvent & {
  reminders: boolean;
  /** Poništava unos koji je već u tuđem kalendaru, umesto da ga doda. */
  cancelled?: boolean;
};

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
  ];

  if (event.cancelled) {
    // Broj izdanja mora da bude veći od onog koji unos već ima; poslati unos
    // ga nije imao, pa važi kao nula.
    lines.push("STATUS:CANCELLED", "SEQUENCE:1");
  } else {
    lines.push("STATUS:CONFIRMED");
  }

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

function wrap(lines: string[], method = "PUBLISH"): string {
  const all = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Doteraj Me//sr",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    ...lines,
    "END:VCALENDAR",
  ];

  return `${all.map(fold).join("\r\n")}\r\n`;
}

export function buildCalendarEvent(event: CalendarEvent): string {
  return wrap(eventLines({ ...event, reminders: true }));
}

/**
 * Otkazivanje termina koji je klijentkinja ranije dodala u svoj kalendar.
 *
 * Telefon nema od koga da sazna da je termin otkazan: `.ics` je jednom
 * preuzet fajl, ne pretplata. Bez ovoga unos ostaje da stoji i, još gore,
 * podsetnici iz njega zvone veče pre i dva sata pre termina koji više ne
 * postoji — pa klijentkinja dođe na otkazan sat.
 *
 * Kalendar poništava unos po `UID`-u, zato on mora da bude isti onaj koji je
 * poslat pri zakazivanju. `METHOD:CANCEL` bez podsetnika: ovo ništa ne
 * zakazuje, samo briše.
 */
export function buildCalendarCancel(event: CalendarEvent): string {
  return wrap(
    eventLines({ ...event, reminders: false, cancelled: true }),
    "CANCEL",
  );
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
 *
 * Otkazan termin izlazi sa `cancelled`, a ne tako što ispadne iz spiska:
 * nestanak reda je nagoveštaj, poništenje je poruka.
 *
 * `empty` je tekst jedinog unosa koji izlazi kad salon nema nijedan termin.
 * Prazan kalendar nije prazan fajl: standard traži bar jednu komponentu
 * unutar `VCALENDAR` (RFC 5545, `component = 1*(eventc / ...)`), pa bez toga
 * dokument nije ispravan i kalendar aplikacija sme da odbije celu pretplatu.
 * Android na to kaže samo „Uvoz nije uspeo", bez razloga.
 */
export function buildCalendarFeed(input: {
  name: string;
  createdAt: Date;
  events: (Omit<CalendarEvent, "createdAt"> & { cancelled?: boolean })[];
  empty: { title: string; description: string };
}): string {
  const header = [
    `X-WR-CALNAME:${escapeText(input.name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  const body =
    input.events.length === 0
      ? emptyMarkerLines(input.createdAt, input.empty)
      : input.events.flatMap((event) =>
          eventLines({ ...event, createdAt: input.createdAt, reminders: false }),
        );

  return wrap([...header, ...body]);
}

/** Datum kao `YYYYMMDD`, oblik koji celodnevni unos traži. */
function dayStamp(value: Date): string {
  return value.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Jedan celodnevni unos, jedini sadržaj kalendara bez termina.
 *
 * `TRANSP:TRANSPARENT` znači da ne zauzima vreme, pa ne pravi rupu u danu.
 * Datum je po UTC-u, a ne po tajmzoni salona, jer prazan odgovor ne nosi ni
 * ime salona ni njegovu tajmzonu — a za oznaku koja nestane čim stigne prvi
 * termin sat razlike ništa ne menja.
 */
function emptyMarkerLines(
  createdAt: Date,
  text: { title: string; description: string },
): string[] {
  const start = dayStamp(createdAt);
  const end = dayStamp(new Date(createdAt.getTime() + 24 * 60 * 60 * 1000));

  return [
    "BEGIN:VEVENT",
    "UID:prazan@doterajme",
    `DTSTAMP:${stamp(createdAt)}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${escapeText(text.title)}`,
    `DESCRIPTION:${escapeText(text.description)}`,
    "STATUS:CONFIRMED",
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ];
}
