import { beforeEach, describe, expect, it, vi } from "vitest";

const { cancel, notify, pending } = vi.hoisted(() => ({
  cancel: vi.fn(),
  notify: vi.fn(),
  pending: [] as Promise<unknown>[],
}));

vi.mock("next/server", () => ({
  after: (work: () => Promise<void>) => {
    pending.push(work());
  },
}));
vi.mock("@/lib/db/public-cancel", () => ({
  cancelPublicAppointment: cancel,
  getAppointmentsForPhone: vi.fn(),
}));
vi.mock("@/lib/device", () => ({ deviceId: async () => "device-1" }));
vi.mock("@/lib/network", () => ({ networkHash: async () => "net-hash" }));
vi.mock("@/lib/messaging/push", () => ({ notifyTenant: notify }));

import { cancelAppointment } from "@/app/(public)/[tenantSlug]/otkazi/actions";
import { sr } from "@/lib/i18n/sr";

const APPOINTMENT_ID = "3b1d1c86-3d3c-4b0a-8a16-6f1f5c0a9d33";

function form(): FormData {
  const data = new FormData();
  data.set("slug", "studio");
  data.set("phone", "+381645123480");
  data.set("appointmentId", APPOINTMENT_ID);
  return data;
}

beforeEach(() => {
  cancel.mockReset();
  notify.mockReset();
  pending.length = 0;
});

describe("cancelAppointment", () => {
  it("dnevno ograničenje otkazivanja po broju vraća poruku koja šalje na salon", async () => {
    cancel.mockResolvedValue({ ok: false, reason: "too_many_cancellations" });

    const result = await cancelAppointment(form());

    expect(result).toEqual({
      status: "error",
      message: sr.cancel.rejected.too_many_cancellations,
    });
    expect(sr.cancel.rejected.too_many_cancellations).toContain("salon");
    expect(notify).not.toHaveBeenCalled();
  });

  it("nepoznat razlog daje opštu poruku, ne sirov kod iz baze", async () => {
    cancel.mockResolvedValue({ ok: false, reason: "nesto_novo" });

    const result = await cancelAppointment(form());

    expect(result).toEqual({ status: "error", message: sr.cancel.failed });
  });

  it("uspešno otkazivanje javi salonu posle odgovora", async () => {
    cancel.mockResolvedValue({
      ok: true,
      appointment: {
        id: APPOINTMENT_ID,
        tenant_id: "9a7b4c11-1f0d-4d1a-8d36-2e7c7f2a5e44",
        timezone: "Europe/Belgrade",
        start_at: "2026-11-02T08:00:00Z",
        end_at: "2026-11-02T09:00:00Z",
        client_name: "Jelena",
        service_name: "Manikir",
      },
    });

    const result = await cancelAppointment(form());
    await Promise.all(pending);

    expect(result).toEqual({ status: "cancelled" });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ template: "client_cancelled" }),
    );
  });
});

describe("cancelAppointment: ponavljanje", () => {
  it("već otkazan termin je uspeh i ne šalje drugo obaveštenje salonu", async () => {
    cancel.mockResolvedValue({ ok: false, reason: "already_cancelled" });

    const result = await cancelAppointment(form());
    await Promise.all(pending);

    expect(result).toEqual({ status: "cancelled" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("ostali razlozi i dalje ostaju greške", async () => {
    cancel.mockResolvedValue({ ok: false, reason: "invalid_transition" });

    const result = await cancelAppointment(form());

    expect(result).toEqual({
      status: "error",
      message: sr.cancel.rejected.invalid_transition,
    });
  });
});
