import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asUser,
  closePool,
  createClient,
  createService,
  createStaff,
  createTenant,
  createUser,
  insertAppointment,
  withRollback,
} from "./helpers";

afterAll(closePool);

async function salonWithAppointment(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId);
  const clientId = await createClient(db, tenantId);
  await insertAppointment(db, {
    tenantId,
    staffId,
    serviceId,
    clientId,
    startAt: "2026-10-06T10:00:00+02:00",
    status: "confirmed",
  });
  const phone = (
    await db.query<{ phone_e164: string }>(
      "select phone_e164 from clients where id = $1",
      [clientId],
    )
  ).rows[0]!.phone_e164;
  return { tenantId, userId, phone };
}

async function clientBlocked(
  db: pg.PoolClient,
  salon: { tenantId: string; userId: string },
): Promise<boolean> {
  return asUser(db, salon.userId, async () => {
    const result = await db.query<{
      week: { appointments: { client_blocked: boolean }[] };
    }>("select dashboard_week('2026-10-05', $1) as week", [salon.tenantId]);
    return result.rows[0]!.week.appointments[0]!.client_blocked;
  });
}

describe("kalendar pokazuje blokiran broj na terminu", () => {
  it("nije blokiran dok broj nije na listi, blokiran je kad jeste", async () => {
    await withRollback(async (db) => {
      const salon = await salonWithAppointment(db);
      expect(await clientBlocked(db, salon)).toBe(false);

      await db.query(
        "insert into blocklist (tenant_id, phone_e164) values ($1, $2)",
        [salon.tenantId, salon.phone],
      );

      expect(await clientBlocked(db, salon)).toBe(true);
    });
  });

  it("blokada u drugom salonu se ne vidi", async () => {
    await withRollback(async (db) => {
      const salon = await salonWithAppointment(db);
      const other = await createTenant(db);
      await db.query(
        "insert into blocklist (tenant_id, phone_e164) values ($1, $2)",
        [other, salon.phone],
      );

      expect(await clientBlocked(db, salon)).toBe(false);
    });
  });
});
