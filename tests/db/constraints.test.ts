import { afterAll, describe, expect, it } from "vitest";
import {
  closePool,
  createClient,
  createService,
  createStaff,
  createTenant,
  inSavepoint,
  insertAppointment,
  withRollback,
} from "./helpers";

afterAll(closePool);

describe("appointments_no_overlap", () => {
  it("odbija dva termina istog izvođača koja se preklapaju", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const staffId = await createStaff(db, tenantId);
      const serviceId = await createService(db, tenantId);
      const clientId = await createClient(db, tenantId);
      const base = { tenantId, staffId, serviceId, clientId };

      await insertAppointment(db, { ...base, startAt: "2026-09-10T08:00:00Z" });

      await expect(
        inSavepoint(db, () =>
          insertAppointment(db, { ...base, startAt: "2026-09-10T08:30:00Z" }),
        ),
      ).rejects.toThrow(/appointments_no_overlap/);
    });
  });

  it("dozvoljava termin koji počinje tačno kad se prethodni završi", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const staffId = await createStaff(db, tenantId);
      const serviceId = await createService(db, tenantId);
      const clientId = await createClient(db, tenantId);
      const base = { tenantId, staffId, serviceId, clientId };

      await insertAppointment(db, { ...base, startAt: "2026-09-10T08:00:00Z" });
      const second = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T09:00:00Z",
      });

      expect(second.id).toBeTruthy();
    });
  });

  it("bafer posle usluge blokira termin koji bi inače stao", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const staffId = await createStaff(db, tenantId);
      const serviceId = await createService(db, tenantId, {
        bufferAfterMin: 15,
      });
      const clientId = await createClient(db, tenantId);
      const base = { tenantId, staffId, serviceId, clientId, bufferAfterMin: 15 };

      await insertAppointment(db, { ...base, startAt: "2026-09-10T08:00:00Z" });

      await expect(
        inSavepoint(db, () =>
          insertAppointment(db, { ...base, startAt: "2026-09-10T09:00:00Z" }),
        ),
      ).rejects.toThrow(/appointments_no_overlap/);

      const later = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T09:15:00Z",
      });
      expect(later.id).toBeTruthy();
    });
  });

  it("otkazan termin oslobađa slot", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const staffId = await createStaff(db, tenantId);
      const serviceId = await createService(db, tenantId);
      const clientId = await createClient(db, tenantId);
      const base = { tenantId, staffId, serviceId, clientId };

      await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
        status: "cancelled_by_client",
      });

      const replacement = await insertAppointment(db, {
        ...base,
        startAt: "2026-09-10T08:00:00Z",
      });
      expect(replacement.id).toBeTruthy();
    });
  });

  it("dva izvođača mogu da rade u isto vreme", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const serviceId = await createService(db, tenantId);
      const clientId = await createClient(db, tenantId);
      const first = await createStaff(db, tenantId, "Milica");
      const second = await createStaff(db, tenantId, "Ana");

      await insertAppointment(db, {
        tenantId,
        staffId: first,
        serviceId,
        clientId,
        startAt: "2026-09-10T08:00:00Z",
      });
      const parallel = await insertAppointment(db, {
        tenantId,
        staffId: second,
        serviceId,
        clientId,
        startAt: "2026-09-10T08:00:00Z",
      });

      expect(parallel.id).toBeTruthy();
    });
  });
});

describe("appointments.end_at", () => {
  it("računa se iz trajanja i ne može se upisati spolja", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const staffId = await createStaff(db, tenantId);
      const serviceId = await createService(db, tenantId, { durationMin: 45 });
      const clientId = await createClient(db, tenantId);

      const appointment = await insertAppointment(db, {
        tenantId,
        staffId,
        serviceId,
        clientId,
        startAt: "2026-09-10T08:00:00Z",
        durationMin: 45,
      });

      expect(appointment.endAt.toISOString()).toBe("2026-09-10T08:45:00.000Z");

      await expect(
        inSavepoint(db, () =>
          db.query("update appointments set end_at = now() where id = $1", [
            appointment.id,
          ]),
        ),
      ).rejects.toThrow(/can only be updated to DEFAULT/);
    });
  });

  it("drži tačno trajanje preko prelaska na letnje vreme", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const staffId = await createStaff(db, tenantId);
      const serviceId = await createService(db, tenantId, { durationMin: 90 });
      const clientId = await createClient(db, tenantId);

      // 29.03.2026. u 01:30 po beogradskom vremenu; sat 02–03 tog dana ne postoji.
      const appointment = await insertAppointment(db, {
        tenantId,
        staffId,
        serviceId,
        clientId,
        startAt: "2026-03-29T00:30:00Z",
        durationMin: 90,
      });

      const local = await db.query<{ start_local: string; end_local: string }>(
        `select to_char(start_at at time zone 'Europe/Belgrade', 'HH24:MI') as start_local,
                to_char(end_at at time zone 'Europe/Belgrade', 'HH24:MI') as end_local
         from appointments where id = $1`,
        [appointment.id],
      );

      expect(local.rows[0]).toEqual({ start_local: "01:30", end_local: "04:00" });
    });
  });
});

describe("working_hours_no_overlap", () => {
  it("dozvoljava podeljenu smenu istog dana", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const staffId = await createStaff(db, tenantId);

      await db.query(
        `insert into working_hours (tenant_id, staff_id, weekday, start_time, end_time)
         values ($1, $2, 1, '09:00', '13:00'), ($1, $2, 1, '16:00', '20:00')`,
        [tenantId, staffId],
      );

      const count = await db.query<{ count: string }>(
        "select count(*)::text as count from working_hours where staff_id = $1",
        [staffId],
      );
      expect(count.rows[0]!.count).toBe("2");
    });
  });

  it("odbija preklapanje smena istog dana", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const staffId = await createStaff(db, tenantId);

      await db.query(
        `insert into working_hours (tenant_id, staff_id, weekday, start_time, end_time)
         values ($1, $2, 1, '09:00', '13:00')`,
        [tenantId, staffId],
      );

      await expect(
        inSavepoint(db, () =>
          db.query(
            `insert into working_hours (tenant_id, staff_id, weekday, start_time, end_time)
             values ($1, $2, 1, '12:00', '15:00')`,
            [tenantId, staffId],
          ),
        ),
      ).rejects.toThrow(/working_hours_no_overlap/);
    });
  });

  it("isti interval na drugom danu prolazi", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const staffId = await createStaff(db, tenantId);

      await db.query(
        `insert into working_hours (tenant_id, staff_id, weekday, start_time, end_time)
         values ($1, $2, 1, '09:00', '13:00'), ($1, $2, 2, '09:00', '13:00')`,
        [tenantId, staffId],
      );

      const count = await db.query<{ count: string }>(
        "select count(*)::text as count from working_hours where staff_id = $1",
        [staffId],
      );
      expect(count.rows[0]!.count).toBe("2");
    });
  });
});

describe("izolacija kroz strane ključeve", () => {
  it("termin ne može da spoji izvođača i uslugu iz različitih tenanta", async () => {
    await withRollback(async (db) => {
      const tenantA = await createTenant(db);
      const tenantB = await createTenant(db);
      const staffA = await createStaff(db, tenantA);
      const serviceB = await createService(db, tenantB);
      const clientA = await createClient(db, tenantA);

      await expect(
        inSavepoint(db, () =>
          insertAppointment(db, {
            tenantId: tenantA,
            staffId: staffA,
            serviceId: serviceB,
            clientId: clientA,
            startAt: "2026-09-10T08:00:00Z",
          }),
        ),
      ).rejects.toThrow(/appointments_tenant_id_service_id_fkey/);
    });
  });

  it("isti broj telefona sme da postoji kod dva različita salona", async () => {
    await withRollback(async (db) => {
      const tenantA = await createTenant(db);
      const tenantB = await createTenant(db);

      await createClient(db, tenantA, "+381641112223");
      const other = await createClient(db, tenantB, "+381641112223");

      expect(other).toBeTruthy();
    });
  });

  it("isti broj telefona dvaput kod istog salona pada", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);

      await createClient(db, tenantId, "+381641112224");

      await expect(
        inSavepoint(db, () => createClient(db, tenantId, "+381641112224")),
      ).rejects.toThrow(/clients_tenant_id_phone_key/);
    });
  });
});
