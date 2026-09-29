import { beforeEach, describe, expect, it, vi } from "vitest";

const { book, notify, pending } = vi.hoisted(() => ({
  book: vi.fn(),
  notify: vi.fn(),
  pending: [] as Promise<unknown>[],
}));

vi.mock("next/server", () => ({
  after: (work: () => Promise<void>) => {
    pending.push(work());
  },
}));
vi.mock("@/lib/db/public-booking", () => ({ bookPublicAppointment: book }));
vi.mock("@/lib/db/appointments", () => ({
  getPriorNoShows: async () => ({ total: 0, latest: [] }),
}));
vi.mock("@/lib/db/services", () => ({
  sequenceProblemSchema: { safeParse: () => ({ success: false }) },
}));
vi.mock("@/lib/device", () => ({ deviceId: async () => "device-1" }));
vi.mock("@/lib/network", () => ({ networkHash: async () => "net-hash" }));
vi.mock("@/lib/messaging/push", () => ({ notifyTenant: notify }));

import { submitBooking } from "@/app/(public)/[tenantSlug]/actions";

const REQUEST_ID = "6f1c3a52-0a9e-4a2e-9f0e-0d5b4c1f7a11";

function form(extra: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set("slug", "studio");
  data.set("serviceId", "0d0a4f3e-8f43-4a3b-9d6e-3a6a1f4b7c22");
  data.set("startAt", "2026-11-02T09:00:00+01:00");
  data.set("name", "Jelena Petrović");
  data.set("phone", "064 512 3480");
  for (const [key, value] of Object.entries(extra)) data.set(key, value);
  return data;
}

const appointment = {
  id: "3b1d1c86-3d3c-4b0a-8a16-6f1f5c0a9d33",
  tenant_id: "9a7b4c11-1f0d-4d1a-8d36-2e7c7f2a5e44",
  timezone: "Europe/Belgrade",
  start_at: "2026-11-02T08:00:00Z",
  end_at: "2026-11-02T09:00:00Z",
  service_name: "Manikir",
  price_rsd: 2500,
};

beforeEach(() => {
  book.mockReset();
  notify.mockReset();
  pending.length = 0;
});

describe("submitBooking", () => {
  it("prosleđuje request_id do baze, zajedno sa hash-om koji je izračunao server", async () => {
    book.mockResolvedValue({ ok: true, appointment });

    await submitBooking(form({ requestId: REQUEST_ID }));

    expect(book).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: REQUEST_ID,
        networkHash: "net-hash",
        deviceId: "device-1",
      }),
    );
  });

  it("bez request_id zahtev i dalje prolazi", async () => {
    book.mockResolvedValue({ ok: true, appointment });

    const result = await submitBooking(form());

    expect(result.status).toBe("booked");
    expect(book).toHaveBeenCalledWith(expect.objectContaining({ requestId: null }));
  });

  it("nevažeći request_id se odbija pre poziva baze", async () => {
    const result = await submitBooking(form({ requestId: "nije-uuid" }));

    expect(result.status).toBe("error");
    expect(book).not.toHaveBeenCalled();
  });

  it("prvi zahtev šalje obaveštenje tačno jednom", async () => {
    book.mockResolvedValue({ ok: true, appointment });

    await submitBooking(form({ requestId: REQUEST_ID }));
    await Promise.all(pending);

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("ponovljen zahtev vraća isti termin kao uspeh i NE šalje obaveštenje", async () => {
    book.mockResolvedValue({ ok: true, replayed: true, appointment });

    const result = await submitBooking(form({ requestId: REQUEST_ID }));
    await Promise.all(pending);

    expect(result).toEqual({
      status: "booked",
      appointment: {
        startAt: appointment.start_at,
        endAt: appointment.end_at,
        serviceName: appointment.service_name,
        priceRsd: appointment.price_rsd,
      },
    });
    expect(notify).not.toHaveBeenCalled();
  });
});
