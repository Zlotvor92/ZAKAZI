import { beforeEach, describe, expect, it, vi } from "vitest";

const { cancel, lookup, notify, pending, proofs, remember } = vi.hoisted(
  () => ({
    cancel: vi.fn(),
    lookup: vi.fn(),
    notify: vi.fn(),
    pending: [] as Promise<unknown>[],
    proofs: { current: [] as string[] },
    remember: vi.fn(),
  }),
);

vi.mock("next/server", () => ({
  after: (work: () => Promise<void>) => {
    pending.push(work());
  },
}));
vi.mock("@/lib/db/public-cancel", () => ({
  cancelPublicAppointment: cancel,
  getAppointmentsForProof: lookup,
}));
vi.mock("@/lib/device", () => ({
  deviceId: async () => "device-1",
  existingDeviceId: async () => "device-1",
}));
vi.mock("@/lib/proof-cookie", () => ({
  readProofs: async () => proofs.current,
  rememberProof: remember,
}));
vi.mock("@/lib/network", () => ({ networkHash: async () => "net-hash" }));
vi.mock("@/lib/messaging/push", () => ({ notifyTenant: notify }));

import {
  cancelAppointment,
  lookupAppointments,
} from "@/app/(public)/[tenantSlug]/otkazi/actions";
import { sr } from "@/lib/i18n/sr";

const APPOINTMENT_ID = "3b1d1c86-3d3c-4b0a-8a16-6f1f5c0a9d33";
const COOKIE_SECRET = "C".repeat(43);
const LINK_SECRET = "L".repeat(43);

function form(extra: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set("slug", "studio");
  data.set("phone", "+381645123480");
  data.set("appointmentId", APPOINTMENT_ID);
  for (const [key, value] of Object.entries(extra)) data.set(key, value);
  return data;
}

function lookupForm(extra: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set("slug", "studio");
  data.set("phone", "064 512 3480");
  for (const [key, value] of Object.entries(extra)) data.set(key, value);
  return data;
}

const found = [
  {
    id: APPOINTMENT_ID,
    start_at: "2026-11-02T08:00:00Z",
    end_at: "2026-11-02T09:00:00Z",
    service_name: "Manikir",
    price_rsd: 2500,
    cancellable: true,
  },
];

beforeEach(() => {
  cancel.mockReset();
  lookup.mockReset();
  notify.mockReset();
  remember.mockReset();
  pending.length = 0;
  proofs.current = [COOKIE_SECRET];
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

describe("cancelAppointment: dokaz", () => {
  it("uz broj šalje bazi tajne iz kolačića i uređaj", async () => {
    cancel.mockResolvedValue({ ok: false, reason: "not_found" });

    await cancelAppointment(form());

    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneE164: "+381645123480",
        secrets: [COOKIE_SECRET],
        deviceId: "device-1",
      }),
    );
  });

  it("tajnu iz linka dodaje ispred onih iz kolačića", async () => {
    cancel.mockResolvedValue({ ok: false, reason: "not_found" });

    await cancelAppointment(form({ linkSecret: LINK_SECRET }));

    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({ secrets: [LINK_SECRET, COOKIE_SECRET] }),
    );
  });

  it("tajnu pogrešnog oblika iz linka ne šalje bazi", async () => {
    cancel.mockResolvedValue({ ok: false, reason: "not_found" });

    await cancelAppointment(form({ linkSecret: "nije-tajna" }));

    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({ secrets: [COOKIE_SECRET] }),
    );
  });

  it("bez kolačića i linka šalje prazan spisak, ne broj samostalno", async () => {
    proofs.current = [];
    cancel.mockResolvedValue({ ok: false, reason: "not_found" });

    const result = await cancelAppointment(form());

    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({ secrets: [] }),
    );
    expect(result).toEqual({
      status: "error",
      message: sr.cancel.rejected.not_found,
    });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("lookupAppointments", () => {
  it("traži po broju, tajnama iz kolačića i uređaju", async () => {
    lookup.mockResolvedValue(found);

    const result = await lookupAppointments(lookupForm());

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith({
      slug: "studio",
      phoneE164: "+381645123480",
      secrets: [COOKIE_SECRET],
      deviceId: "device-1",
    });
    expect(result).toEqual({
      status: "found",
      phone: "+381645123480",
      appointments: found,
    });
    expect(remember).not.toHaveBeenCalled();
  });

  it("bez dokaza vraća prazan spisak kao i za pogrešan broj", async () => {
    proofs.current = [];
    lookup.mockResolvedValue([]);

    const result = await lookupAppointments(lookupForm());

    expect(result).toEqual({
      status: "found",
      phone: "+381645123480",
      appointments: [],
    });
  });

  it("tajnu iz linka pamti tek kad sama otvara termin tog broja", async () => {
    lookup.mockResolvedValue(found);

    await lookupAppointments(lookupForm({ linkSecret: LINK_SECRET }));

    expect(lookup).toHaveBeenNthCalledWith(1, {
      slug: "studio",
      phoneE164: "+381645123480",
      secrets: [LINK_SECRET],
      deviceId: null,
    });
    expect(remember).toHaveBeenCalledWith("studio", LINK_SECRET);
    expect(lookup).toHaveBeenNthCalledWith(2, {
      slug: "studio",
      phoneE164: "+381645123480",
      secrets: [LINK_SECRET, COOKIE_SECRET],
      deviceId: "device-1",
    });
  });

  it("izmišljen link ne ulazi u kolačić i ne istiskuje prave tajne", async () => {
    lookup.mockResolvedValueOnce([]).mockResolvedValueOnce(found);

    const result = await lookupAppointments(
      lookupForm({ linkSecret: LINK_SECRET }),
    );

    expect(remember).not.toHaveBeenCalled();
    expect(result.status).toBe("found");
  });

  it("link pogrešnog oblika se ne pita u bazi", async () => {
    lookup.mockResolvedValue(found);

    await lookupAppointments(lookupForm({ linkSecret: "nije-tajna" }));

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(remember).not.toHaveBeenCalled();
  });

  it("nepostojeći ili suspendovan salon daje poruku da je zatvoreno", async () => {
    lookup.mockResolvedValue(null);

    const result = await lookupAppointments(lookupForm());

    expect(result).toEqual({ status: "error", message: sr.booking.closed });
  });

  it("neispravan broj se odbija pre poziva baze", async () => {
    const result = await lookupAppointments(lookupForm({ phone: "064 12" }));

    expect(result.status).toBe("error");
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("cancelAppointment: prekasno", () => {
  it("manje od 24 sata pre termina aplikacija sama ispisuje poruku i ne javlja salonu", async () => {
    cancel.mockResolvedValue({ ok: false, reason: "too_late" });

    const result = await cancelAppointment(form());

    expect(result).toEqual({
      status: "error",
      message: sr.cancel.rejected.too_late,
    });
    expect(notify).not.toHaveBeenCalled();
  });
});
