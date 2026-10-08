import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(dashboard)/dashboard/termin/novi/actions", () => ({
  saveAppointment: vi.fn(),
}));

import { AppointmentForm } from "@/app/(dashboard)/dashboard/termin/novi/appointment-form";
import type { Service } from "@/lib/db/services";

function service(id: string, name: string, durationMin: number): Service {
  return {
    id,
    name,
    duration_min: durationMin,
    price_rsd: 2000,
  } as Service;
}

function render(services: Service[], defaultDuration: number): string {
  return renderToStaticMarkup(
    createElement(AppointmentForm, {
      services,
      date: "2026-10-12",
      defaultDuration,
    }),
  );
}

/** Opcije trajanja i koja je izabrana. */
function durationSelect(html: string) {
  const select = html.match(/<select[^>]*id="durationMin"[^>]*>(.*?)<\/select>/s);
  const options = [...(select?.[1] ?? "").matchAll(/<option([^>]*)>(\d+) min<\/option>/g)];

  return options.map((option) => ({
    minutes: Number(option[2]),
    selected: /selected/.test(option[1] ?? ""),
  }));
}

describe("AppointmentForm: trajanje usluge", () => {
  it.each([20, 75, 105])(
    "usluga od %i minuta ima svoju opciju i ona je izabrana",
    (minutes) => {
      const options = durationSelect(render([service("a", "Usluga", minutes)], minutes));

      expect(options.map((option) => option.minutes)).toContain(minutes);
      expect(options.filter((option) => option.selected)).toEqual([
        { minutes, selected: true },
      ]);
    },
  );

  it("opcija usluge od 75 minuta postoji i kad je izabrana prva, kraća usluga", () => {
    const options = durationSelect(
      render([service("a", "Kratka", 30), service("b", "Srednja", 75)], 30),
    );

    expect(options.map((option) => option.minutes)).toContain(75);
    expect(options.find((option) => option.selected)?.minutes).toBe(30);
  });
});
