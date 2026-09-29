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
 * Limit po broju (2 nedeljno, 4 buduća) proverava se pre upisa, pa su ga
 * paralelni zahtevi istog broja svi videli nepopunjenog. Prave konekcije.
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

describe("limit po broju telefona pod trkom", () => {
  it("isti broj sa 10 istovremenih zahteva ne prolazi više od 2 u nedelji", async () => {
    const phone = mobile(500);
    const times = [
      "09:00", "09:15", "09:30", "09:45", "10:00",
      "10:15", "10:30", "10:45", "11:00", "11:15",
    ];

    const results = await Promise.all(
      await Promise.all(
        times.map(async (time, index) =>
          bookAsServer({
            slug: salon.slug,
            serviceId: salon.serviceId,
            startAt: await localInstant(20, time),
            phone,
            deviceId: `limit-device-${index}`,
            requestId: randomUUID(),
          }),
        ),
      ),
    );

    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(2);
    expect(
      await count(
        `select count(*)::int as n from appointments a
           join clients c on c.id = a.client_id
          where a.tenant_id=$1 and c.phone_e164=$2`,
        [salon.tenantId, phone],
      ),
    ).toBeLessThanOrEqual(2);
  });

  it("zaključavanje je po broju: drugi brojevi se ne čekaju i ne blokiraju", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, async (_, index) =>
        bookAsServer({
          slug: salon.slug,
          serviceId: salon.serviceId,
          startAt: await localInstant(21, `${9 + index}:00`),
          phone: mobile(600 + index),
          deviceId: `other-${index}`,
          requestId: randomUUID(),
        }),
      ),
    );

    expect(results.every((r) => r.ok)).toBe(true);
  });
});

