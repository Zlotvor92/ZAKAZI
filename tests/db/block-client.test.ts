import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  closePool,
  createClient,
  createService,
  createStaff,
  createTenant,
  createUser,
  inSavepoint,
  insertAppointment,
  withRollback,
} from "./helpers";

afterAll(closePool);

type BlockResult =
  | { ok: true; phone_e164: string }
  | { ok: false; reason: string };

async function salonWithAppointment(db: pg.PoolClient, phone: string) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId);
  const clientId = await createClient(db, tenantId, phone);
  const appointment = await insertAppointment(db, {
    tenantId,
    staffId,
    serviceId,
    clientId,
    startAt: "2026-09-14T08:00:00Z",
  });

  return { tenantId, userId, appointmentId: appointment.id };
}

async function block(
  db: pg.PoolClient,
  appointmentId: string,
): Promise<BlockResult> {
  const result = await db.query<{ result: BlockResult }>(
    "select block_appointment_client($1, $2) as result",
    [appointmentId, "uzastopno ne dolazi"],
  );
  return result.rows[0]!.result;
}

describe("blokiranje sa termina", () => {
  it("upisuje broj klijentkinje u listu", async () => {
    await withRollback(async (db) => {
      const phone = "+381645558001";
      const base = await salonWithAppointment(db, phone);

      const result = await asUser(db, base.userId, () =>
        block(db, base.appointmentId),
      );

      expect(result).toEqual({ ok: true, phone_e164: phone });

      const rows = await db.query<{ phone_e164: string; created_by: string }>(
        "select phone_e164, created_by from blocklist where tenant_id = $1",
        [base.tenantId],
      );
      expect(rows.rows[0]).toEqual({ phone_e164: phone, created_by: base.userId });
    });
  });

  it("dvaput zaredom ne puca", async () => {
    await withRollback(async (db) => {
      const base = await salonWithAppointment(db, "+381645558002");

      await asUser(db, base.userId, async () => {
        expect((await block(db, base.appointmentId)).ok).toBe(true);
        expect((await block(db, base.appointmentId)).ok).toBe(true);
      });

      const rows = await db.query("select 1 from blocklist where tenant_id = $1", [
        base.tenantId,
      ]);
      expect(rows.rowCount).toBe(1);
    });
  });

  it("ne dira sam termin", async () => {
    await withRollback(async (db) => {
      const base = await salonWithAppointment(db, "+381645558003");

      await asUser(db, base.userId, () => block(db, base.appointmentId));

      const row = await db.query<{ status: string }>(
        "select status from appointments where id = $1",
        [base.appointmentId],
      );
      expect(row.rows[0]!.status).toBe("confirmed");
    });
  });

  it("vlasnica drugog salona ne može da blokira tuđeg klijenta", async () => {
    await withRollback(async (db) => {
      const base = await salonWithAppointment(db, "+381645558004");
      const other = await createTenant(db);
      const intruder = await createUser(db, other);

      const result = await asUser(db, intruder, () =>
        block(db, base.appointmentId),
      );

      expect(result).toEqual({ ok: false, reason: "not_found" });

      const rows = await db.query("select 1 from blocklist");
      expect(rows.rowCount).toBe(0);
    });
  });

  it("neulogovan posetilac ne sme ni da pozove funkciju", async () => {
    await withRollback(async (db) => {
      const base = await salonWithAppointment(db, "+381645558005");

      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () => block(db, base.appointmentId)),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });
});
