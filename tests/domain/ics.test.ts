import { describe, expect, it } from "vitest";
import { buildCalendarEvent, type CalendarEvent } from "@/lib/domain/ics";

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    uid: "abc-123@zakazi",
    startAt: new Date("2026-08-18T07:00:00Z"),
    endAt: new Date("2026-08-18T08:30:00Z"),
    createdAt: new Date("2026-08-17T05:00:00Z"),
    title: "Gel nokti",
    location: "Studio Milica",
    description: "Termin zakazan preko sajta.",
    ...overrides,
  };
}

function lines(text: string): string[] {
  return text.split("\r\n");
}

describe("kalendarski unos", () => {
  it("ima okvir koji čitači očekuju", () => {
    const rows = lines(buildCalendarEvent(event()));

    expect(rows[0]).toBe("BEGIN:VCALENDAR");
    expect(rows).toContain("BEGIN:VEVENT");
    expect(rows).toContain("END:VEVENT");
    expect(rows.at(-2)).toBe("END:VCALENDAR");
  });

  it("svaki red se završava povratkom i novim redom", () => {
    const text = buildCalendarEvent(event());

    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.includes("\n\n")).toBe(false);
  });

  it("vremena su u UTC-u, bez crtica i dvotačaka", () => {
    const rows = lines(buildCalendarEvent(event()));

    expect(rows).toContain("DTSTART:20260818T070000Z");
    expect(rows).toContain("DTEND:20260818T083000Z");
    expect(rows).toContain("DTSTAMP:20260817T050000Z");
  });

  it("nosi naziv usluge i ime salona", () => {
    const rows = lines(buildCalendarEvent(event()));

    expect(rows).toContain("SUMMARY:Gel nokti");
    expect(rows).toContain("LOCATION:Studio Milica");
  });
});

describe("podsetnici", () => {
  it("javlja veče pre i dva sata pre", () => {
    const rows = lines(buildCalendarEvent(event()));

    expect(rows.filter((row) => row === "BEGIN:VALARM")).toHaveLength(2);
    expect(rows).toContain("TRIGGER:-P1D");
    expect(rows).toContain("TRIGGER:-PT2H");
  });
});

describe("tekst koji ima značenje u formatu", () => {
  it("zarez, tačka-zarez i obrnuta kosa crta se pobegnu", () => {
    const rows = lines(
      buildCalendarEvent(
        event({ title: "Gel nokti, korekcija; sa dodatkom \\ ukrasa" }),
      ),
    );

    expect(rows).toContain(
      "SUMMARY:Gel nokti\\, korekcija\\; sa dodatkom \\\\ ukrasa",
    );
  });

  it("prelom reda postaje dva znaka umesto pravog preloma", () => {
    const text = buildCalendarEvent(
      event({ description: "Prvi red\nDrugi red" }),
    );

    expect(text).toContain("DESCRIPTION:Prvi red\\nDrugi red");
    expect(lines(text).some((row) => row === "Drugi red")).toBe(false);
  });
});

describe("prelamanje dugih redova", () => {
  it("red duži od sedamdeset pet okteta se prelama", () => {
    const rows = lines(
      buildCalendarEvent(event({ title: "a".repeat(200) })),
    );

    const encoder = new TextEncoder();
    for (const row of rows) {
      expect(encoder.encode(row).length).toBeLessThanOrEqual(75);
    }
  });

  it("nastavak reda počinje razmakom", () => {
    const rows = lines(buildCalendarEvent(event({ title: "a".repeat(200) })));
    const summary = rows.findIndex((row) => row.startsWith("SUMMARY:"));

    expect(rows[summary + 1]!.startsWith(" ")).toBe(true);
  });

  it("srpsko slovo se ne preseca na pola", () => {
    // Č, ć, š, ž i đ su po dva okteta; prelamanje po znakovima bi ih raspolovilo.
    const title = "Šišanje i čišćenje đevđirom".repeat(6);
    const text = buildCalendarEvent(event({ title }));

    // Kad bi se slovo preseklo, spajanje nazad ne bi dalo isti tekst.
    const unfolded = text.replace(/\r\n /g, "");

    expect(unfolded).toContain(`SUMMARY:${title}`);
  });

  it("kratak red ostaje netaknut", () => {
    const rows = lines(buildCalendarEvent(event()));

    expect(rows).toContain("SUMMARY:Gel nokti");
  });
});
