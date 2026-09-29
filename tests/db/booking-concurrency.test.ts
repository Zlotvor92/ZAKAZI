import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bookAsServer,
  cleanupSalon,
  createCommittedSalon,
  localInstant,
  mobile,
  racePool,
  type Salon,
} from "./race";

/**
 * Prave paralelne konekcije, svaka sa svojom transakcijom i commit-om. Jedna
 * transakcija ne može da se trka sama sa sobom, pa `withRollback` ovde ne
 * dokazuje ništa.
 */

let salon: Salon;

beforeAll(async () => {
  salon = await createCommittedSalon();
});

afterAll(async () => {
  await cleanupSalon(salon);
  await racePool.end();
});

async function count(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await racePool.query(sql, params);
  return rows[0].n;
}

describe("trka za isti termin", () => {
  it("od 12 istovremenih zahteva sa različitim request_id prolazi tačno jedan", async () => {
    const startAt = await localInstant(10, "10:00");

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        bookAsServer({
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt,
          phone: mobile(index),
          deviceId: `race-device-${index}`,
          requestId: randomUUID(),
        }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      results.filter((r) => !r.ok).every((r) => r.reason === "slot_taken"),
    ).toBe(true);
    expect(
      await count(
        "select count(*)::int as n from appointments where tenant_id=$1 and start_at=$2",
        [salon.tenantId, startAt],
      ),
    ).toBe(1);
  });

  it("nijedan zahtev ne završi izuzetkom (deadlock) u 5 rundi po 20 istovremenih", async () => {
    for (let round = 0; round < 5; round += 1) {
      const startAt = await localInstant(40 + round, "11:00");

      const results = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          bookAsServer({
            slug: salon.slug,
            serviceId: salon.serviceId,
            startAt,
            phone: mobile(200 + round * 20 + index),
            deviceId: `deadlock-${round}-${index}`,
            requestId: randomUUID(),
          }),
        ),
      );

      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(
        results.filter((r) => !r.ok).every((r) => r.reason === "slot_taken"),
      ).toBe(true);
    }
  });

  it("gubitnici ne ostavljaju klijenta ni događaj u istoriji", async () => {
    const startAt = await localInstant(11, "10:00");

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        bookAsServer({
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt,
          phone: mobile(100 + index),
          deviceId: `partial-${index}`,
          requestId: randomUUID(),
        }),
      ),
    );

    expect(
      await count(
        "select count(*)::int as n from appointments where tenant_id=$1 and start_at=$2",
        [salon.tenantId, startAt],
      ),
    ).toBe(1);
    expect(
      await count(
        `select count(*)::int as n from appointment_events e
           join appointments a on a.id = e.appointment_id
          where e.tenant_id=$1 and a.start_at=$2`,
        [salon.tenantId, startAt],
      ),
    ).toBe(1);
    expect(
      await count(
        "select count(*)::int as n from clients where tenant_id=$1 and phone_e164 = any($2)",
        [salon.tenantId, Array.from({ length: 8 }, (_, i) => mobile(100 + i))],
      ),
    ).toBe(1);
  });
});

describe("ponovljen zahtev (idempotentnost)", () => {
  it("isti request_id dvaput daje isti termin, bez greške drugom odgovoru", async () => {
    const args = {
      slug: salon.slug,
      serviceId: salon.serviceId,
      startAt: await localInstant(25, "12:00"),
      phone: mobile(700),
      deviceId: "retry-device",
      requestId: randomUUID(),
    };

    const first = await bookAsServer(args);
    const second = await bookAsServer(args);

    expect(first).toMatchObject({ ok: true });
    expect(first.replayed).toBeUndefined();
    expect(second).toMatchObject({ ok: true, replayed: true });
    expect(second.appointment?.id).toBe(first.appointment?.id);
  });

  it("ponavljanje ne pravi drugi termin, klijenta ni događaj", async () => {
    const requestId = randomUUID();
    const startAt = await localInstant(26, "12:00");
    const args = {
      slug: salon.slug,
      serviceId: salon.serviceId,
      startAt,
      phone: mobile(701),
      deviceId: "retry-device-2",
      requestId,
    };

    await bookAsServer(args);
    await bookAsServer(args);
    await bookAsServer(args);

    expect(
      await count(
        `select count(*)::int as n from appointments a
           join clients c on c.id = a.client_id
          where a.tenant_id=$1 and c.phone_e164=$2`,
        [salon.tenantId, mobile(701)],
      ),
    ).toBe(1);
    expect(
      await count(
        `select count(*)::int as n from appointment_events e
           join appointments a on a.id = e.appointment_id
          where e.tenant_id=$1 and a.request_id=$2`,
        [salon.tenantId, requestId],
      ),
    ).toBe(1);
    expect(
      await count(
        "select count(*)::int as n from clients where tenant_id=$1 and phone_e164=$2",
        [salon.tenantId, mobile(701)],
      ),
    ).toBe(1);
  });

  it("5 istovremenih zahteva sa istim request_id: tačno jedan termin, svi dobijaju isti", async () => {
    const args = {
      slug: salon.slug,
      serviceId: salon.serviceId,
      startAt: await localInstant(27, "12:00"),
      phone: mobile(702),
      deviceId: "same-request",
      requestId: randomUUID(),
    };

    const results = await Promise.all(
      Array.from({ length: 5 }, () => bookAsServer(args)),
    );

    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.map((r) => r.appointment?.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
  });

  it("isti request_id za drugi broj se odbija i ne otkriva tuđi termin", async () => {
    const requestId = randomUUID();
    const startAt = await localInstant(28, "12:00");
    const base = {
      slug: salon.slug,
      serviceId: salon.serviceId,
      startAt,
      deviceId: "conflict-device",
      requestId,
    };

    await bookAsServer({ ...base, phone: mobile(703) });
    const other = await bookAsServer({ ...base, phone: mobile(704) });

    expect(other).toEqual({ ok: false, reason: "request_conflict" });
  });

  it("ponavljanje ne troši limit: prolazi i kad je uređaj u pauzi od 30 s", async () => {
    const args = {
      slug: salon.slug,
      serviceId: salon.serviceId,
      startAt: await localInstant(29, "13:00"),
      phone: mobile(705),
      deviceId: "cooldown-device",
      requestId: randomUUID(),
    };

    expect((await bookAsServer(args)).ok).toBe(true);
    expect(await bookAsServer(args)).toMatchObject({ ok: true, replayed: true });
  });

  it("zahtev bez request_id radi kao i pre", async () => {
    const result = await bookAsServer({
      slug: salon.slug,
      serviceId: salon.serviceId,
      startAt: await localInstant(30, "13:00"),
      phone: mobile(706),
    });

    expect(result.ok).toBe(true);
  });
});
