import { describe, expect, it } from "vitest";
import { buildCalendarFeed } from "@/lib/domain/ics";

const createdAt = new Date("2026-09-01T10:00:00Z");

function event(overrides: Partial<{ uid: string; title: string }> = {}) {
  return {
    uid: overrides.uid ?? "prvi@doterajme",
    startAt: new Date("2026-09-10T08:00:00Z"),
    endAt: new Date("2026-09-10T09:30:00Z"),
    title: overrides.title ?? "Jelena — Gel nokti",
    location: "Studio Milica",
    description: "+381601234567",
  };
}

describe("kalendar salona", () => {
  it("prazan kalendar je i dalje ispravan fajl", () => {
    const ics = buildCalendarFeed({ name: "Studio Milica", createdAt, events: [] });

    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("svaki termin je zaseban unos", () => {
    const ics = buildCalendarFeed({
      name: "Studio Milica",
      createdAt,
      events: [event(), event({ uid: "drugi@doterajme", title: "Mila — Trepavice" })],
    });

    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.match(/END:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("UID:prvi@doterajme");
    expect(ics).toContain("UID:drugi@doterajme");
  });

  it("nema alarma — dan sa deset termina ne sme da zvoni dvadeset puta", () => {
    const ics = buildCalendarFeed({
      name: "Studio Milica",
      createdAt,
      events: [event(), event({ uid: "drugi@doterajme" })],
    });

    expect(ics).not.toContain("BEGIN:VALARM");
  });

  it("ime kalendara ide u zaglavlje, pobegnuto", () => {
    const ics = buildCalendarFeed({
      name: "Studio, Milica",
      createdAt,
      events: [],
    });

    expect(ics).toContain("X-WR-CALNAME:Studio\\, Milica");
  });

  it("vreme je u UTC-u, bez crtica i dvotačaka", () => {
    const ics = buildCalendarFeed({ name: "Salon", createdAt, events: [event()] });

    expect(ics).toContain("DTSTART:20260910T080000Z");
    expect(ics).toContain("DTEND:20260910T093000Z");
  });

  it("nijedan red ne prelazi 75 okteta", () => {
    const ics = buildCalendarFeed({
      name: "Salon sa vrlo dugačkim imenom koje sigurno prelazi granicu reda",
      createdAt,
      events: [
        event({
          title: "Klijentkinja sa dugačkim imenom — usluga sa još dužim nazivom",
        }),
      ],
    });

    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});
