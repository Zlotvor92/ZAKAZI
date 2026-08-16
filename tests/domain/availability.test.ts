import { formatInTimeZone } from "date-fns-tz";
import { describe, expect, it } from "vitest";
import {
  bookingWindow,
  buildAvailability,
  type AvailabilityInput,
  type BusyRange,
} from "@/lib/domain/availability";
import type { WorkingInterval } from "@/lib/domain/calendar";

const BELGRADE = "Europe/Belgrade";

/** Podeljena smena pon–pet 09–13 i 16–20, subota 09–14, nedelja slobodno. */
const SPLIT_SHIFT: WorkingInterval[] = [
  ...[1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, startMinute: 9 * 60, endMinute: 13 * 60 },
    { weekday, startMinute: 16 * 60, endMinute: 20 * 60 },
  ]),
  { weekday: 6, startMinute: 9 * 60, endMinute: 14 * 60 },
];

const MORNING_ONLY: WorkingInterval[] = [
  { weekday: 1, startMinute: 9 * 60, endMinute: 13 * 60 },
];

/** `now` daleko u prošlosti da najraniji termin ne seče ništa slučajno. */
const LONG_AGO = new Date("2026-01-01T00:00:00Z");

function availability(
  overrides: Partial<AvailabilityInput> & Pick<AvailabilityInput, "fromDate">,
) {
  return buildAvailability({
    timeZone: BELGRADE,
    toDate: overrides.fromDate,
    workingHours: MORNING_ONLY,
    busy: [],
    durationMin: 60,
    bufferAfterMin: 0,
    slotStepMin: 15,
    now: LONG_AGO,
    minLeadMin: 0,
    ...overrides,
  });
}

/** Termini jednog dana kao `HH:MM` po Beogradu, radi čitljivosti očekivanja. */
function localTimes(slots: Date[]): string[] {
  return slots.map((slot) => formatInTimeZone(slot, BELGRADE, "HH:mm"));
}

function busy(startAt: string, endAt: string): BusyRange {
  return { startAt: new Date(startAt), endAt: new Date(endAt) };
}

describe("mreža od 15 minuta", () => {
  it("nudi termine od otvaranja dok usluga staje do zatvaranja", () => {
    // 2026-08-10 je ponedeljak. Radno vreme 09–13, usluga 60 minuta.
    const [monday] = availability({ fromDate: "2026-08-10" });

    expect(localTimes(monday!.slots)).toEqual([
      "09:00",
      "09:15",
      "09:30",
      "09:45",
      "10:00",
      "10:15",
      "10:30",
      "10:45",
      "11:00",
      "11:15",
      "11:30",
      "11:45",
      "12:00",
    ]);
  });

  it("usluga koja ne staje do zatvaranja ne dobija termin", () => {
    const [monday] = availability({
      fromDate: "2026-08-10",
      durationMin: 4 * 60,
    });

    expect(localTimes(monday!.slots)).toEqual(["09:00"]);
  });

  it("usluga duža od radnog vremena ne dobija nijedan termin", () => {
    const [monday] = availability({
      fromDate: "2026-08-10",
      durationMin: 5 * 60,
    });

    expect(monday!.slots).toEqual([]);
  });

  it("mreža je usidrena za otvaranje, ne za pun sat", () => {
    const [monday] = availability({
      fromDate: "2026-08-10",
      workingHours: [{ weekday: 1, startMinute: 9 * 60 + 10, endMinute: 12 * 60 }],
      durationMin: 45,
    });

    expect(localTimes(monday!.slots).slice(0, 3)).toEqual([
      "09:10",
      "09:25",
      "09:40",
    ]);
  });

  it("korak od nula minuta je greška, ne beskonačna petlja", () => {
    expect(() =>
      availability({ fromDate: "2026-08-10", slotStepMin: 0 }),
    ).toThrow();
  });
});

describe("trajanje dolazi sa usluge", () => {
  it("isti dan daje različite termine za različite usluge", () => {
    // Zauzeto 10–13, ostaje samo jedan sat ujutru.
    const taken = [busy("2026-08-10T08:00:00Z", "2026-08-10T11:00:00Z")];

    const manikir = availability({
      fromDate: "2026-08-10",
      busy: taken,
      durationMin: 45,
    })[0]!;
    const trepavice = availability({
      fromDate: "2026-08-10",
      busy: taken,
      durationMin: 180,
    })[0]!;

    expect(localTimes(manikir.slots)).toEqual(["09:00", "09:15"]);
    expect(trepavice.slots).toEqual([]);
  });
});

describe("bafer", () => {
  it("sme da pređe kraj radnog vremena", () => {
    // Salon radi do 13h. Usluga od sat vremena sa 15 minuta spremanja sme da
    // počne u 12h — usluga se završi u 13h, spremanje ide do 13:15.
    const [monday] = availability({
      fromDate: "2026-08-10",
      durationMin: 60,
      bufferAfterMin: 15,
    });

    expect(localTimes(monday!.slots).at(-1)).toBe("12:00");
  });

  it("ne sme da pređe u tuđi termin", () => {
    // Zauzeto od 12:00. Bez bafera bi 11:00 bilo slobodno; sa 15 minuta
    // spremanja usluga od sat vremena mora da počne najkasnije u 10:45.
    const [monday] = availability({
      fromDate: "2026-08-10",
      busy: [busy("2026-08-10T10:00:00Z", "2026-08-10T11:00:00Z")],
      durationMin: 60,
      bufferAfterMin: 15,
    });

    expect(localTimes(monday!.slots).at(-1)).toBe("10:45");
  });
});

describe("zauzeto vreme", () => {
  it("termin koji dodiruje zauzeto se ne nudi", () => {
    const [monday] = availability({
      fromDate: "2026-08-10",
      busy: [busy("2026-08-10T08:00:00Z", "2026-08-10T09:00:00Z")],
    });

    expect(localTimes(monday!.slots)).toEqual([
      "09:00",
      "11:00",
      "11:15",
      "11:30",
      "11:45",
      "12:00",
    ]);
  });

  it("termin koji se naslanja na zauzeto se nudi", () => {
    // Zauzeto 10:00–11:00 po Beogradu. Usluga od sat vremena sme tačno u 11:00.
    const [monday] = availability({
      fromDate: "2026-08-10",
      busy: [busy("2026-08-10T08:00:00Z", "2026-08-10T09:00:00Z")],
    });

    expect(localTimes(monday!.slots)).toContain("11:00");
  });

  it("odsustvo pojede ceo dan", () => {
    const [monday] = availability({
      fromDate: "2026-08-10",
      busy: [busy("2026-08-10T00:00:00Z", "2026-08-11T00:00:00Z")],
    });

    expect(monday!.slots).toEqual([]);
  });

  it("zauzeto iz drugog dana ne dira ovaj", () => {
    const [monday] = availability({
      fromDate: "2026-08-10",
      busy: [busy("2026-08-11T08:00:00Z", "2026-08-11T12:00:00Z")],
    });

    expect(monday!.slots).toHaveLength(13);
  });
});

describe("podeljena smena", () => {
  it("pauza između dve smene se ne nudi", () => {
    const [monday] = availability({
      fromDate: "2026-08-10",
      workingHours: SPLIT_SHIFT,
    });

    const times = localTimes(monday!.slots);

    expect(times).toContain("12:00");
    expect(times).not.toContain("13:00");
    expect(times).not.toContain("14:00");
    expect(times).not.toContain("15:00");
    expect(times).toContain("16:00");
  });

  it("termini su poređani po vremenu bez obzira na redosled smena", () => {
    const [monday] = availability({
      fromDate: "2026-08-10",
      workingHours: [
        { weekday: 1, startMinute: 16 * 60, endMinute: 20 * 60 },
        { weekday: 1, startMinute: 9 * 60, endMinute: 13 * 60 },
      ],
    });

    const times = localTimes(monday!.slots);

    expect(times[0]).toBe("09:00");
    expect([...times].sort()).toEqual(times);
  });

  it("dan bez radnog vremena nema termine ali postoji u odgovoru", () => {
    const days = availability({
      fromDate: "2026-08-10",
      toDate: "2026-08-16",
      workingHours: SPLIT_SHIFT,
    });

    expect(days).toHaveLength(7);
    expect(days[6]!.date).toBe("2026-08-16");
    expect(days[6]!.slots).toEqual([]);
  });
});

describe("najraniji termin", () => {
  it("seče jutro koje je prekasno za zakazivanje", () => {
    // Ponedeljak 09:30 po Beogradu, najranije za dva sata: prvi termin 11:30.
    const [monday] = availability({
      fromDate: "2026-08-10",
      now: new Date("2026-08-10T07:30:00Z"),
      minLeadMin: 120,
    });

    expect(localTimes(monday!.slots)[0]).toBe("11:30");
  });

  it("bez najranijeg termina prvi slot je otvaranje", () => {
    const [monday] = availability({
      fromDate: "2026-08-10",
      now: new Date("2026-08-10T05:00:00Z"),
      minLeadMin: 0,
    });

    expect(localTimes(monday!.slots)[0]).toBe("09:00");
  });

  it("dan koji je već prošao nema termine", () => {
    const [monday] = availability({
      fromDate: "2026-08-10",
      now: new Date("2026-08-10T18:00:00Z"),
      minLeadMin: 0,
    });

    expect(monday!.slots).toEqual([]);
  });
});

describe("prelazak na drugo računanje vremena", () => {
  it("dan pre prelaska na letnje vreme: 09:00 je 08:00 UTC", () => {
    const [saturday] = availability({
      fromDate: "2026-03-28",
      workingHours: [{ weekday: 6, startMinute: 9 * 60, endMinute: 13 * 60 }],
    });

    expect(saturday!.slots[0]!.toISOString()).toBe("2026-03-28T08:00:00.000Z");
  });

  it("dan prelaska na letnje vreme: 09:00 je 07:00 UTC", () => {
    // 29.03.2026. sat skače sa 02:00 na 03:00.
    const [sunday] = availability({
      fromDate: "2026-03-29",
      workingHours: [{ weekday: 7, startMinute: 9 * 60, endMinute: 13 * 60 }],
    });

    expect(sunday!.slots[0]!.toISOString()).toBe("2026-03-29T07:00:00.000Z");
  });

  it("dan pre prelaska na zimsko vreme: 09:00 je 07:00 UTC", () => {
    const [saturday] = availability({
      fromDate: "2026-10-24",
      workingHours: [{ weekday: 6, startMinute: 9 * 60, endMinute: 13 * 60 }],
    });

    expect(saturday!.slots[0]!.toISOString()).toBe("2026-10-24T07:00:00.000Z");
  });

  it("dan prelaska na zimsko vreme: 09:00 je 08:00 UTC", () => {
    // 25.10.2026. sat se vraća sa 03:00 na 02:00.
    const [sunday] = availability({
      fromDate: "2026-10-25",
      workingHours: [{ weekday: 7, startMinute: 9 * 60, endMinute: 13 * 60 }],
    });

    expect(sunday!.slots[0]!.toISOString()).toBe("2026-10-25T08:00:00.000Z");
  });

  it("termin zakazan u martu za oktobar pada na tačan sat", () => {
    // Ovo je pravilo iz specifikacije: gledano iz marta, kad je na snazi
    // letnje vreme, oktobarski termin u 10:00 mora biti 09:00 UTC, ne 08:00.
    const days = buildAvailability({
      timeZone: BELGRADE,
      fromDate: "2026-10-26",
      toDate: "2026-10-26",
      workingHours: [{ weekday: 1, startMinute: 10 * 60, endMinute: 12 * 60 }],
      busy: [],
      durationMin: 60,
      bufferAfterMin: 0,
      slotStepMin: 15,
      now: new Date("2026-03-30T12:00:00Z"),
      minLeadMin: 0,
    });

    expect(days[0]!.slots[0]!.toISOString()).toBe("2026-10-26T09:00:00.000Z");
    expect(localTimes(days[0]!.slots)[0]).toBe("10:00");
  });

  it("broj termina u danu ne zavisi od prelaska", () => {
    const before = availability({
      fromDate: "2026-10-24",
      workingHours: [{ weekday: 6, startMinute: 9 * 60, endMinute: 13 * 60 }],
    });
    const after = availability({
      fromDate: "2026-10-31",
      workingHours: [{ weekday: 6, startMinute: 9 * 60, endMinute: 13 * 60 }],
    });

    expect(before[0]!.slots).toHaveLength(after[0]!.slots.length);
  });
});

describe("radno vreme do ponoći", () => {
  it("24:00 je kraj dana, ne njegov početak", () => {
    const [monday] = availability({
      fromDate: "2026-08-10",
      workingHours: [{ weekday: 1, startMinute: 22 * 60, endMinute: 24 * 60 }],
    });

    expect(localTimes(monday!.slots)).toEqual(["22:00", "22:15", "22:30", "22:45", "23:00"]);
  });
});

describe("raspon dana koji se nudi", () => {
  it("horizont od 14 dana znači danas i još četrnaest", () => {
    const window = bookingWindow({
      now: new Date("2026-08-10T12:00:00Z"),
      timeZone: BELGRADE,
      horizonDays: 14,
    });

    expect(window).toEqual({ fromDate: "2026-08-10", toDate: "2026-08-24" });
  });

  it("prvi dan je današnji po Beogradu, ne po UTC-u", () => {
    // 22:30 UTC je već sutradan u Beogradu.
    const window = bookingWindow({
      now: new Date("2026-08-10T22:30:00Z"),
      timeZone: BELGRADE,
      horizonDays: 7,
    });

    expect(window.fromDate).toBe("2026-08-11");
  });

  it("svaki dan iz raspona postoji u odgovoru", () => {
    const days = availability({
      fromDate: "2026-08-10",
      toDate: "2026-08-24",
      workingHours: SPLIT_SHIFT,
    });

    expect(days).toHaveLength(15);
    expect(days.map((day) => day.date).at(-1)).toBe("2026-08-24");
  });

  it("prazan raspon vraća praznu listu", () => {
    const days = availability({ fromDate: "2026-08-10", toDate: "2026-08-09" });

    expect(days).toEqual([]);
  });
});
