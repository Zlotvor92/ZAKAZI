import { formatInTimeZone } from "date-fns-tz";
import { describe, expect, it } from "vitest";
import {
  buildAvailability,
  slotMinutesForCount,
  slotsInBlock,
  type AvailabilityInput,
  type BusyRange,
  type WorkingBlock,
} from "@/lib/domain/availability";

const BELGRADE = "Europe/Belgrade";

/** Radno vreme kakvo ima sestrin salon: dva termina pre i dva posle podne. */
const SISTER: WorkingBlock[] = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday, startMinute: 9 * 60, endMinute: 12 * 60, slotMinutes: 90 },
  { weekday, startMinute: 17 * 60, endMinute: 20 * 60, slotMinutes: 90 },
]);

const MORNING: WorkingBlock[] = [
  { weekday: 1, startMinute: 9 * 60, endMinute: 12 * 60, slotMinutes: 90 },
];

const LONG_AGO = new Date("2026-01-01T00:00:00Z");

function availability(
  overrides: Partial<AvailabilityInput> & Pick<AvailabilityInput, "fromDate">,
) {
  return buildAvailability({
    timeZone: BELGRADE,
    toDate: overrides.fromDate,
    blocks: MORNING,
    busy: [],
    serviceMinutes: 90,
    now: LONG_AGO,
    minLeadMin: 0,
    ...overrides,
  });
}

function times(day: { slots: { startAt: Date }[] } | undefined): string[] {
  return (day?.slots ?? []).map((slot) =>
    formatInTimeZone(slot.startAt, BELGRADE, "HH:mm"),
  );
}

function busy(startAt: string, endAt: string): BusyRange {
  return { startAt: new Date(startAt), endAt: new Date(endAt) };
}

describe("koliko termina staje u blok", () => {
  it("tri sata na devedeset minuta daju dva termina", () => {
    expect(
      slotsInBlock({
        weekday: 1,
        startMinute: 540,
        endMinute: 720,
        slotMinutes: 90,
      }),
    ).toBe(2);
  });

  it("poslednji termin sme da pređe kraj bloka", () => {
    // Četiri sata na devedeset minuta: tri dolaska, poslednji u 12:00.
    expect(
      slotsInBlock({
        weekday: 1,
        startMinute: 540,
        endMinute: 780,
        slotMinutes: 90,
      }),
    ).toBe(3);
  });

  it("razmak duži od bloka i dalje prima jednom", () => {
    expect(
      slotsInBlock({
        weekday: 1,
        startMinute: 540,
        endMinute: 600,
        slotMinutes: 90,
      }),
    ).toBe(1);
  });
});

describe("iz broja termina u trajanje", () => {
  it("tri sata podeljena na dva daju devedeset minuta", () => {
    expect(slotMinutesForCount(9 * 60, 12 * 60, 2)).toBe(90);
  });

  it("četiri sata na tri daju osamdeset minuta", () => {
    expect(slotMinutesForCount(9 * 60, 13 * 60, 3)).toBe(80);
  });

  it("razmak se zaokružuje naviše da bi broj dolazaka ispao tačan", () => {
    const block = {
      weekday: 1,
      startMinute: 9 * 60,
      endMinute: 12 * 60 + 30,
      slotMinutes: slotMinutesForCount(9 * 60, 12 * 60 + 30, 2),
    };

    expect(slotsInBlock(block)).toBe(2);
  });

  it("nula termina ne deli sa nulom", () => {
    expect(slotMinutesForCount(9 * 60, 12 * 60, 0)).toBe(180);
  });
});

describe("slobodni termini", () => {
  it("sestrin ponedeljak ima tačno četiri termina", () => {
    // 2026-08-10 je ponedeljak.
    const [monday] = availability({ fromDate: "2026-08-10", blocks: SISTER });

    expect(times(monday)).toEqual(["09:00", "10:30", "17:00", "18:30"]);
  });

  it("termin počinje tačno kad se prethodni završi", () => {
    const [monday] = availability({ fromDate: "2026-08-10" });

    expect(times(monday)).toEqual(["09:00", "10:30"]);
  });

  it("svaki termin nosi svoje trajanje", () => {
    const [monday] = availability({ fromDate: "2026-08-10" });

    expect(monday!.slots.map((slot) => slot.minutes)).toEqual([90, 90]);
  });

  it("poslednji dolazak sme da se prelije preko kraja bloka", () => {
    // 09–13 na razmak od 90: dolazi se u 9, 10:30 i 12, a poslednji se završi
    // u 13:30. To je stvar salona, ne aplikacije.
    const [monday] = availability({
      fromDate: "2026-08-10",
      blocks: [
        { weekday: 1, startMinute: 9 * 60, endMinute: 13 * 60, slotMinutes: 90 },
      ],
    });

    expect(times(monday)).toEqual(["09:00", "10:30", "12:00"]);
  });

  it("pauza između blokova se ne nudi", () => {
    const [monday] = availability({ fromDate: "2026-08-10", blocks: SISTER });

    expect(times(monday)).not.toContain("12:00");
    expect(times(monday)).not.toContain("13:30");
  });

  it("termini su poređani bez obzira na redosled blokova", () => {
    const [monday] = availability({
      fromDate: "2026-08-10",
      blocks: [
        { weekday: 1, startMinute: 17 * 60, endMinute: 20 * 60, slotMinutes: 90 },
        { weekday: 1, startMinute: 9 * 60, endMinute: 12 * 60, slotMinutes: 90 },
      ],
    });

    expect(times(monday)).toEqual(["09:00", "10:30", "17:00", "18:30"]);
  });

  it("dan bez radnog vremena postoji u odgovoru ali je prazan", () => {
    const days = availability({
      fromDate: "2026-08-10",
      toDate: "2026-08-16",
      blocks: SISTER,
    });

    expect(days).toHaveLength(7);
    expect(days[6]!.slots).toEqual([]);
  });

  it("razmak od nule ne pravi beskonačno termina", () => {
    const [monday] = availability({
      fromDate: "2026-08-10",
      blocks: [
        { weekday: 1, startMinute: 9 * 60, endMinute: 12 * 60, slotMinutes: 0 },
      ],
    });

    expect(monday!.slots).toEqual([]);
  });
});

describe("zauzeto vreme", () => {
  it("zauzet termin nestaje, ostali ostaju", () => {
    // 09:00 po Beogradu je 07:00 UTC leti.
    const [monday] = availability({
      fromDate: "2026-08-10",
      blocks: SISTER,
      busy: [busy("2026-08-10T07:00:00Z", "2026-08-10T08:30:00Z")],
    });

    expect(times(monday)).toEqual(["10:30", "17:00", "18:30"]);
  });

  it("termin koji se naslanja na zauzeto se i dalje nudi", () => {
    const [monday] = availability({
      fromDate: "2026-08-10",
      busy: [busy("2026-08-10T05:30:00Z", "2026-08-10T07:00:00Z")],
    });

    expect(times(monday)).toContain("09:00");
  });

  it("odsustvo pojede ceo dan", () => {
    const [monday] = availability({
      fromDate: "2026-08-10",
      blocks: SISTER,
      busy: [busy("2026-08-10T00:00:00Z", "2026-08-11T00:00:00Z")],
    });

    expect(monday!.slots).toEqual([]);
  });

  it("zauzeto iz drugog dana ne dira ovaj", () => {
    const [monday] = availability({
      fromDate: "2026-08-10",
      busy: [busy("2026-08-11T07:00:00Z", "2026-08-11T08:30:00Z")],
    });

    expect(times(monday)).toHaveLength(2);
  });
});

describe("najraniji termin", () => {
  it("seče ono što je prekasno zakazati", () => {
    // Ponedeljak 09:30 po Beogradu, najranije za dva sata.
    const [monday] = availability({
      fromDate: "2026-08-10",
      blocks: SISTER,
      now: new Date("2026-08-10T07:30:00Z"),
      minLeadMin: 120,
    });

    expect(times(monday)).toEqual(["17:00", "18:30"]);
  });

  it("dan koji je prošao nema termine", () => {
    const [monday] = availability({
      fromDate: "2026-08-10",
      blocks: SISTER,
      now: new Date("2026-08-10T20:00:00Z"),
      minLeadMin: 0,
    });

    expect(monday!.slots).toEqual([]);
  });
});

describe("prelazak na drugo računanje vremena", () => {
  it("dan pre prelaska na zimsko: 09:00 je 07:00 UTC", () => {
    const [saturday] = availability({
      fromDate: "2026-10-24",
      blocks: [
        { weekday: 6, startMinute: 9 * 60, endMinute: 12 * 60, slotMinutes: 90 },
      ],
    });

    expect(saturday!.slots[0]!.startAt.toISOString()).toBe(
      "2026-10-24T07:00:00.000Z",
    );
  });

  it("dan prelaska na zimsko: 09:00 je 08:00 UTC", () => {
    const [sunday] = availability({
      fromDate: "2026-10-25",
      blocks: [
        { weekday: 7, startMinute: 9 * 60, endMinute: 12 * 60, slotMinutes: 90 },
      ],
    });

    expect(sunday!.slots[0]!.startAt.toISOString()).toBe(
      "2026-10-25T08:00:00.000Z",
    );
  });

  it("termin zakazan u martu za oktobar pada na tačan sat", () => {
    const days = buildAvailability({
      timeZone: BELGRADE,
      fromDate: "2026-10-26",
      toDate: "2026-10-26",
      blocks: [
        { weekday: 1, startMinute: 10 * 60, endMinute: 13 * 60, slotMinutes: 90 },
      ],
      busy: [],
      serviceMinutes: 90,
      now: new Date("2026-03-30T12:00:00Z"),
      minLeadMin: 0,
    });

    expect(days[0]!.slots[0]!.startAt.toISOString()).toBe(
      "2026-10-26T09:00:00.000Z",
    );
    expect(times(days[0])[0]).toBe("10:00");
  });

  it("broj termina u danu ne zavisi od prelaska", () => {
    const before = availability({
      fromDate: "2026-10-24",
      blocks: [
        { weekday: 6, startMinute: 9 * 60, endMinute: 12 * 60, slotMinutes: 90 },
      ],
    });
    const after = availability({
      fromDate: "2026-10-31",
      blocks: [
        { weekday: 6, startMinute: 9 * 60, endMinute: 12 * 60, slotMinutes: 90 },
      ],
    });

    expect(before[0]!.slots).toHaveLength(after[0]!.slots.length);
  });
});

describe("radno vreme do ponoći", () => {
  it("24:00 je kraj dana, ne njegov početak", () => {
    const [monday] = availability({
      fromDate: "2026-08-10",
      blocks: [
        { weekday: 1, startMinute: 21 * 60, endMinute: 24 * 60, slotMinutes: 90 },
      ],
    });

    expect(times(monday)).toEqual(["21:00", "22:30"]);
  });
});

describe("raspon dana", () => {
  it("svaki dan iz raspona postoji u odgovoru", () => {
    const days = availability({
      fromDate: "2026-08-10",
      toDate: "2026-08-24",
      blocks: SISTER,
    });

    expect(days).toHaveLength(15);
    expect(days.map((day) => day.date).at(-1)).toBe("2026-08-24");
  });

  it("prazan raspon vraća praznu listu", () => {
    const days = availability({ fromDate: "2026-08-10", toDate: "2026-08-09" });

    expect(days).toEqual([]);
  });
});

describe("duga usluga gura ostatak dana", () => {
  it("dvočasovna nadogradnja u 9 pomera sledeći dolazak sa 10:30 na 11", () => {
    // Sestrin ponedeljak: 09–12 i 17–20, razmak sat i po.
    const [monday] = availability({
      fromDate: "2026-08-10",
      blocks: SISTER,
      serviceMinutes: 90,
      // 09:00–11:00 po Beogradu je 07:00–09:00 UTC leti.
      busy: [busy("2026-08-10T07:00:00Z", "2026-08-10T09:00:00Z")],
    });

    expect(times(monday)).toEqual(["11:00", "17:00", "18:30"]);
  });

  it("termin od sat i po u 9 ne pomera ništa", () => {
    const [monday] = availability({
      fromDate: "2026-08-10",
      blocks: SISTER,
      busy: [busy("2026-08-10T07:00:00Z", "2026-08-10T08:30:00Z")],
    });

    expect(times(monday)).toEqual(["10:30", "17:00", "18:30"]);
  });

  it("pomereni dolazak sme da se prelije preko kraja bloka", () => {
    // Nadogradnja u 17 drži do 19; sledeći je u 19 i traje do 20:30.
    const [monday] = availability({
      fromDate: "2026-08-10",
      blocks: SISTER,
      serviceMinutes: 90,
      busy: [busy("2026-08-10T15:00:00Z", "2026-08-10T17:00:00Z")],
    });

    expect(times(monday)).toContain("19:00");
  });

  it("duga usluga se ne nudi tamo gde bi ušla u tuđi termin", () => {
    // Zauzeto 10:30–12:00. Nadogradnja od dva sata u 9 bi ušla u to, a u
    // 12:00 se ne može jer je tu kraj bloka — pre podne tog dana otpada celo.
    const [monday] = availability({
      fromDate: "2026-08-10",
      blocks: SISTER,
      serviceMinutes: 120,
      busy: [busy("2026-08-10T08:30:00Z", "2026-08-10T10:00:00Z")],
    });

    expect(times(monday)).toEqual(["17:00", "18:30"]);
  });

  it("isti dan nudi različita vremena za usluge različite dužine", () => {
    const taken = [busy("2026-08-10T07:00:00Z", "2026-08-10T09:00:00Z")];

    const short = availability({
      fromDate: "2026-08-10",
      blocks: SISTER,
      serviceMinutes: 90,
      busy: taken,
    })[0]!;
    const long = availability({
      fromDate: "2026-08-10",
      blocks: SISTER,
      serviceMinutes: 120,
      busy: taken,
    })[0]!;

    expect(times(short)).toContain("11:00");
    expect(times(long)).toContain("11:00");
    expect(long.slots.every((slot) => slot.minutes === 120)).toBe(true);
  });

  it("odsustvo takođe pomera sledeći dolazak", () => {
    // Lekar 09:00–10:00; posle njega se može odmah, iako nije na rasporedu.
    const [monday] = availability({
      fromDate: "2026-08-10",
      blocks: SISTER,
      busy: [busy("2026-08-10T07:00:00Z", "2026-08-10T08:00:00Z")],
    });

    expect(times(monday)).toContain("10:00");
  });
});
