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

type WriteResult =
  | { ok: true; appointment_id: string }
  | { ok: false; reason: string };

async function salon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId, { bufferAfterMin: 15 });

  await db.query(
    `insert into working_hours (tenant_id, staff_id, weekday, start_time, end_time)
     values ($1, $2, 1, '09:00', '13:00')`,
    [tenantId, staffId],
  );

  return { tenantId, userId, staffId, serviceId };
}

async function create(
  db: pg.PoolClient,
  input: {
    serviceId: string;
    startAt: string;
    name?: string;
    phone?: string;
    deviceId?: string;
  },
): Promise<WriteResult> {
  const result = await db.query<{ result: WriteResult }>(
    "select create_appointment($1, $2, $3, $4, $5) as result",
    [
      input.serviceId,
      input.startAt,
      input.name ?? "Jelena",
      input.phone ?? "+381641234567",
      input.deviceId ?? null,
    ],
  );
  return result.rows[0]!.result;
}

describe("vlasnica unosi termin", () => {
  it("upisuje potvrđen termin sa izvorom salon", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      const result = await asUser(db, base.userId, () =>
        create(db, {
          serviceId: base.serviceId,
          startAt: "2026-09-14T08:00:00Z",
        }),
      );

      expect(result.ok).toBe(true);

      const row = await db.query<{ status: string; source: string }>(
        "select status, source from appointments where tenant_id = $1",
        [base.tenantId],
      );
      expect(row.rows[0]).toMatchObject({ status: "confirmed", source: "salon" });
    });
  });

  it("pravi klijenta ako ga nema, a ne dira postojećeg", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const phone = "+381645559001";

      await asUser(db, base.userId, async () => {
        await create(db, {
          serviceId: base.serviceId,
          startAt: "2026-09-14T08:00:00Z",
          name: "Jelena Petrović",
          phone,
        });
        await create(db, {
          serviceId: base.serviceId,
          startAt: "2026-09-15T08:00:00Z",
          name: "jeca",
          phone,
        });
      });

      const clients = await db.query<{ name: string }>(
        "select name from clients where tenant_id = $1",
        [base.tenantId],
      );
      expect(clients.rows).toEqual([{ name: "Jelena Petrović" }]);
    });
  });

  it("trajanje, bafer i cena se prepisuju sa usluge", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await asUser(db, base.userId, () =>
        create(db, {
          serviceId: base.serviceId,
          startAt: "2026-09-14T08:00:00Z",
        }),
      );

      const row = await db.query<{
        duration_min: number;
        buffer_after_min: number;
        price_rsd: number;
      }>(
        "select duration_min, buffer_after_min, price_rsd from appointments where tenant_id = $1",
        [base.tenantId],
      );
      expect(row.rows[0]).toEqual({
        duration_min: 60,
        buffer_after_min: 15,
        price_rsd: 2500,
      });
    });
  });

  it("ostavlja trag sa vlasnicom kao akterom i uređajem", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await asUser(db, base.userId, () =>
        create(db, {
          serviceId: base.serviceId,
          startAt: "2026-09-14T08:00:00Z",
          deviceId: "telefon-vlasnice",
        }),
      );

      const event = await db.query<{
        actor_type: string;
        actor_id: string;
        device_id: string;
      }>(
        "select actor_type, actor_id, device_id from appointment_events where tenant_id = $1",
        [base.tenantId],
      );
      expect(event.rows[0]).toEqual({
        actor_type: "user",
        actor_id: base.userId,
        device_id: "telefon-vlasnice",
      });
    });
  });
});

describe("vlasnica nije vezana pravilima javne stranice", () => {
  it("sme van radnog vremena", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      // Ponedeljak u 22h, salon radi 09–13.
      const result = await asUser(db, base.userId, () =>
        create(db, {
          serviceId: base.serviceId,
          startAt: "2026-09-14T20:00:00Z",
        }),
      );

      expect(result.ok).toBe(true);
    });
  });

  it("sme van mreže od petnaest minuta", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      const result = await asUser(db, base.userId, () =>
        create(db, {
          serviceId: base.serviceId,
          startAt: "2026-09-14T08:07:00Z",
        }),
      );

      expect(result.ok).toBe(true);
    });
  });

  it("sme da primi blokiran broj", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const phone = "+381645559002";
      await db.query(
        "insert into blocklist (tenant_id, phone_e164) values ($1, $2)",
        [base.tenantId, phone],
      );

      const result = await asUser(db, base.userId, () =>
        create(db, {
          serviceId: base.serviceId,
          startAt: "2026-09-14T08:00:00Z",
          phone,
        }),
      );

      expect(result.ok).toBe(true);
    });
  });

  it("sme preko limita koji važe za javno zakazivanje", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const phone = "+381645559003";

      await asUser(db, base.userId, async () => {
        for (const hour of ["08", "10", "12"]) {
          const result = await create(db, {
            serviceId: base.serviceId,
            startAt: `2026-09-14T${hour}:00:00Z`,
            phone,
          });
          expect(result.ok).toBe(true);
        }
      });
    });
  });
});

describe("granice koje i za vlasnicu važe", () => {
  it("dupla rezervacija ne prolazi", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const clientId = await createClient(db, base.tenantId, "+381645559004");

      await insertAppointment(db, {
        tenantId: base.tenantId,
        staffId: base.staffId,
        serviceId: base.serviceId,
        clientId,
        startAt: "2026-09-14T08:00:00Z",
        bufferAfterMin: 15,
      });

      const result = await asUser(db, base.userId, () =>
        create(db, {
          serviceId: base.serviceId,
          startAt: "2026-09-14T08:30:00Z",
          phone: "+381645559005",
        }),
      );

      expect(result).toEqual({ ok: false, reason: "slot_taken" });
    });
  });

  it("bafer prethodnog termina i dalje blokira", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await asUser(db, base.userId, async () => {
        await create(db, {
          serviceId: base.serviceId,
          startAt: "2026-09-14T08:00:00Z",
        });

        // Prethodni drži 08:00–09:15 sa baferom.
        const result = await create(db, {
          serviceId: base.serviceId,
          startAt: "2026-09-14T09:00:00Z",
          phone: "+381645559006",
        });

        expect(result).toEqual({ ok: false, reason: "slot_taken" });
      });
    });
  });

  it("prazno ime i loš telefon padaju", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await asUser(db, base.userId, async () => {
        expect(
          await create(db, {
            serviceId: base.serviceId,
            startAt: "2026-09-14T08:00:00Z",
            name: "   ",
          }),
        ).toEqual({ ok: false, reason: "invalid_name" });

        expect(
          await create(db, {
            serviceId: base.serviceId,
            startAt: "2026-09-14T08:00:00Z",
            phone: "0641234567",
          }),
        ).toEqual({ ok: false, reason: "invalid_phone" });
      });
    });
  });

  it("odbijen pokušaj ne ostavlja klijenta", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await asUser(db, base.userId, () =>
        create(db, {
          serviceId: base.serviceId,
          startAt: "2026-09-14T08:00:00Z",
          phone: "064",
        }),
      );

      const clients = await db.query("select 1 from clients where tenant_id = $1", [
        base.tenantId,
      ]);
      expect(clients.rowCount).toBe(0);
    });
  });
});

describe("granica salona", () => {
  it("vlasnica ne može da upiše termin u tuđi salon", async () => {
    await withRollback(async (db) => {
      const mine = await salon(db);
      const theirs = await salon(db);

      const result = await asUser(db, mine.userId, () =>
        create(db, {
          serviceId: theirs.serviceId,
          startAt: "2026-09-14T08:00:00Z",
        }),
      );

      expect(result).toEqual({ ok: false, reason: "unknown_service" });
    });
  });

  it("neulogovan posetilac ne sme ni da pozove funkciju", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () =>
            create(db, {
              serviceId: base.serviceId,
              startAt: "2026-09-14T08:00:00Z",
            }),
          ),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });

  it("spisak usluga ne prelazi granicu salona", async () => {
    await withRollback(async (db) => {
      const mine = await salon(db);
      await salon(db);

      const rows = await asUser(db, mine.userId, () =>
        db.query<{ id: string }>("select id from tenant_services()"),
      );

      expect(rows.rows.map((row) => row.id)).toEqual([mine.serviceId]);
    });
  });
});
