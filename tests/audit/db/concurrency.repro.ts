import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bookAsAnon,
  cleanupSalon,
  createCommittedSalon,
  localInstant,
  mobile,
  racePool,
  type Salon,
} from "./concurrency";

/**
 * AUDIT — prave paralelne konekcije (svaki poziv ima svoju transakciju).
 * Testovi označeni [REPRO] opisuju ISPRAVNO ponašanje i trenutno PADAJU.
 * Ostali su potvrde da nešto radi kako treba i prolaze.
 */

let salon: Salon;

beforeAll(async () => {
  salon = await createCommittedSalon();
});

afterAll(async () => {
  await cleanupSalon(salon);
  await racePool.end();
});

describe("trka za isti termin", () => {
  it("od 12 istovremenih zahteva prolazi tačno jedan, ostali dobiju slot_taken", async () => {
    const startAt = await localInstant(10, "10:00");

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        bookAsAnon({
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt,
          phone: mobile(index),
          deviceId: `race-device-${index}`,
        }),
      ),
    );

    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);

    expect(winners).toHaveLength(1);
    expect(losers.every((r) => r.reason === "slot_taken")).toBe(true);

    const rows = await racePool.query(
      "select count(*)::int as n from appointments where tenant_id=$1 and start_at=$2",
      [salon.tenantId, startAt],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it("gubitnici ne ostavljaju klijenta ni događaj u istoriji (nema delimičnog stanja)", async () => {
    const startAt = await localInstant(11, "10:00");

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        bookAsAnon({
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt,
          phone: mobile(100 + index),
          deviceId: `partial-${index}`,
        }),
      ),
    );

    const appointments = await racePool.query(
      "select count(*)::int as n from appointments where tenant_id=$1 and start_at=$2",
      [salon.tenantId, startAt],
    );
    const events = await racePool.query(
      `select count(*)::int as n from appointment_events e
       join appointments a on a.id = e.appointment_id
       where e.tenant_id=$1 and a.start_at=$2`,
      [salon.tenantId, startAt],
    );
    const clients = await racePool.query(
      `select count(*)::int as n from clients
       where tenant_id=$1 and phone_e164 = any($2)`,
      [salon.tenantId, Array.from({ length: 8 }, (_, i) => mobile(100 + i))],
    );

    expect(appointments.rows[0].n).toBe(1);
    expect(events.rows[0].n).toBe(1);
    expect(clients.rows[0].n).toBe(1);
  });
});

describe("limit po broju telefona pod trkom", () => {
  it("[REPRO] isti broj sa 10 istovremenih zahteva ne sme da prođe više od 2 u nedelji", async () => {
    // Pravilo iz booking_limit_reason: c_max_per_week = 2 (±7 dana), a
    // nepoznat broj najviše 4 buduća. Provera i upis nisu zaključani.
    const phone = mobile(500);
    const times = [
      "09:00", "09:15", "09:30", "09:45", "10:00",
      "10:15", "10:30", "10:45", "11:00", "11:15",
    ];

    const results = await Promise.all(
      await Promise.all(
        times.map(async (time, index) =>
          bookAsAnon({
            slug: salon.slug,
            serviceId: salon.serviceId,
            startAt: await localInstant(20, time),
            phone,
            deviceId: `limit-device-${index}`,
          }),
        ),
      ),
    );

    const accepted = results.filter((r) => r.ok).length;
    expect(accepted).toBeLessThanOrEqual(2);
  });
});

describe("ponovljen zahtev (idempotentnost)", () => {
  it("[REPRO] isti zahtev poslat dvaput daje isti termin, a ne grešku drugom odgovoru", async () => {
    // Scenario: odgovor A se izgubi, klijent šalje B sa istim podacima.
    const startAt = await localInstant(25, "12:00");
    const args = {
      slug: salon.slug,
      serviceId: salon.serviceId,
      startAt,
      phone: mobile(700),
      deviceId: "retry-device",
    };

    const first = await bookAsAnon(args);
    const second = await bookAsAnon(args);

    expect(first.ok).toBe(true);
    // Očekivano: ok + isti id. Stvarno: ok=false (too_fast / slot_taken).
    expect(second.reason ?? "ok").toBe("ok");
    expect(second.ok).toBe(true);
    expect(second.appointment?.id).toBe(first.appointment?.id);
  });

  it("ponovljen zahtev ipak ne pravi drugi termin", async () => {
    const startAt = await localInstant(26, "12:00");
    const args = {
      slug: salon.slug,
      serviceId: salon.serviceId,
      startAt,
      phone: mobile(701),
      deviceId: "retry-device-2",
    };

    await Promise.all([bookAsAnon(args), bookAsAnon(args), bookAsAnon(args)]);

    const rows = await racePool.query(
      `select count(*)::int as n from appointments a
       join clients c on c.id = a.client_id
       where a.tenant_id=$1 and c.phone_e164=$2`,
      [salon.tenantId, mobile(701)],
    );
    expect(rows.rows[0].n).toBe(1);
  });
});
