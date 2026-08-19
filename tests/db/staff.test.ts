import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
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

type WriteResult = { ok: true; id?: string } | { ok: false; reason: string };

type BookResult =
  | { ok: true; appointment: { id: string } }
  | { ok: false; reason: string };

/** Salon sa jednom osobom koja ponedeljkom radi 09–18 u terminima od 90 min. */
async function salon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId, "Milica");
  const serviceId = await createService(db, tenantId, 90);

  await db.query(
    "insert into staff_services (tenant_id, staff_id, service_id) values ($1, $2, $3)",
    [tenantId, staffId, serviceId],
  );
  await db.query(
    `insert into working_hours
       (tenant_id, staff_id, weekday, start_time, end_time, slot_minutes)
     values ($1, $2, 1, '09:00', '18:00', 90)`,
    [tenantId, staffId],
  );

  const slug = await db.query<{ slug: string }>(
    "select slug from tenants where id = $1",
    [tenantId],
  );

  return { tenantId, userId, staffId, serviceId, slug: slug.rows[0]!.slug };
}

async function save(
  db: pg.PoolClient,
  input: { name?: string; staffId?: string | null; tenantId?: string | null } = {},
): Promise<WriteResult> {
  const result = await db.query<{ result: WriteResult }>(
    "select set_staff($1, $2, $3) as result",
    [input.name ?? "Ana", input.staffId ?? null, input.tenantId ?? null],
  );
  return result.rows[0]!.result;
}

async function deactivate(
  db: pg.PoolClient,
  staffId: string,
  tenantId: string | null = null,
): Promise<WriteResult> {
  const result = await db.query<{ result: WriteResult }>(
    "select deactivate_staff($1, $2) as result",
    [staffId, tenantId],
  );
  return result.rows[0]!.result;
}

async function nextMonday(db: pg.PoolClient, atTime = "09:00"): Promise<string> {
  const result = await db.query<{ at: string }>(
    `select to_char(
              (date_trunc('week', (now() at time zone 'Europe/Belgrade')::date + 14)::date
               + $1::time) at time zone 'Europe/Belgrade',
              'YYYY-MM-DD"T"HH24:MI:SSOF'
            ) as at`,
    [atTime],
  );
  return result.rows[0]!.at;
}

async function book(
  db: pg.PoolClient,
  input: {
    slug: string;
    serviceId: string;
    startAt: string;
    phone: string;
    staffId?: string | null;
  },
): Promise<BookResult> {
  const result = await db.query<{ result: BookResult }>(
    "select public_book($1, $2, $3, $4, $5, null, null, $6) as result",
    [
      input.slug,
      input.serviceId,
      input.startAt,
      "Jelena",
      input.phone,
      input.staffId ?? null,
    ],
  );
  return result.rows[0]!.result;
}

describe("salon dodaje drugu osobu", () => {
  it("nova osoba nasleđuje radno vreme i usluge prve", async () => {
    // Bez nasleđivanja bi bila dodata, videla bi se u spisku, a klijent joj ne
    // bi mogao zakazati ništa — nema radnog vremena, nema veze sa uslugom.
    await withRollback(async (db) => {
      const base = await salon(db);

      const result = await asUser(db, base.userId, () =>
        save(db, { name: "Ana" }),
      );

      expect(result.ok).toBe(true);
      const id = (result as { ok: true; id: string }).id;

      const hours = await db.query<{ weekday: number; slot_minutes: number }>(
        "select weekday, slot_minutes from working_hours where staff_id = $1",
        [id],
      );
      expect(hours.rows).toEqual([{ weekday: 1, slot_minutes: 90 }]);

      const services = await db.query(
        "select 1 from staff_services where staff_id = $1 and service_id = $2",
        [id, base.serviceId],
      );
      expect(services.rowCount).toBe(1);
    });
  });

  it("treća osoba se odbija", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await asUser(db, base.userId, async () => {
        expect((await save(db, { name: "Ana" })).ok).toBe(true);
        expect(await save(db, { name: "Sanja" })).toEqual({
          ok: false,
          reason: "too_many",
        });
      });
    });
  });

  it("prazno ime se odbija", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      const result = await asUser(db, base.userId, () =>
        save(db, { name: "   " }),
      );

      expect(result).toEqual({ ok: false, reason: "invalid_name" });
    });
  });

  it("postojeća osoba se preimenuje bez nove", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      const result = await asUser(db, base.userId, () =>
        save(db, { name: "Milica P.", staffId: base.staffId }),
      );

      expect(result.ok).toBe(true);

      const rows = await db.query<{ name: string }>(
        "select name from staff where tenant_id = $1",
        [base.tenantId],
      );
      expect(rows.rows).toEqual([{ name: "Milica P." }]);
    });
  });
});

describe("uklanjanje osobe", () => {
  it("poslednja osoba ne može da se ukloni", async () => {
    // Salon bez ijednog izvođača ne prima nijedan termin — ni sa javne strane
    // ni ručno.
    await withRollback(async (db) => {
      const base = await salon(db);

      const result = await asUser(db, base.userId, () =>
        deactivate(db, base.staffId),
      );

      expect(result).toEqual({ ok: false, reason: "last_one" });
    });
  });

  it("druga osoba se gasi, a njeni termini ostaju", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const added = await asUser(db, base.userId, () => save(db, { name: "Ana" }));
      const id = (added as { ok: true; id: string }).id;

      const clientId = await createClient(db, base.tenantId);
      const appointment = await insertAppointment(db, {
        tenantId: base.tenantId,
        staffId: id,
        serviceId: base.serviceId,
        clientId,
        startAt: "2026-09-14T08:00:00Z",
      });

      const result = await asUser(db, base.userId, () => deactivate(db, id));

      expect(result).toEqual({ ok: true });

      const row = await db.query<{ active: boolean }>(
        "select active from staff where id = $1",
        [id],
      );
      expect(row.rows[0]!.active).toBe(false);

      const left = await db.query("select 1 from appointments where id = $1", [
        appointment.id,
      ]);
      expect(left.rowCount).toBe(1);
    });
  });
});

describe("granica salona", () => {
  it("vlasnica ne preimenuje tuđu osobu", async () => {
    await withRollback(async (db) => {
      const mine = await salon(db);
      const theirs = await salon(db);

      const result = await asUser(db, mine.userId, () =>
        save(db, {
          name: "Ukradeno",
          staffId: theirs.staffId,
          tenantId: mine.tenantId,
        }),
      );

      expect(result).toEqual({ ok: false, reason: "not_found" });

      const row = await db.query<{ name: string }>(
        "select name from staff where id = $1",
        [theirs.staffId],
      );
      expect(row.rows[0]!.name).toBe("Milica");
    });
  });

  it("vlasnica ne gasi tuđu osobu", async () => {
    await withRollback(async (db) => {
      const mine = await salon(db);
      const theirs = await salon(db);
      await asUser(db, theirs.userId, () => save(db, { name: "Ana" }));

      const result = await asUser(db, mine.userId, () =>
        deactivate(db, theirs.staffId, mine.tenantId),
      );

      expect(result).toEqual({ ok: false, reason: "not_found" });
    });
  });

  it("spisak pokazuje samo svoje osobe", async () => {
    await withRollback(async (db) => {
      const mine = await salon(db);
      const theirs = await salon(db);
      await asUser(db, theirs.userId, () => save(db, { name: "Tuđa" }));

      const rows = await asUser(db, mine.userId, async () => {
        const result = await db.query<{ name: string }>(
          "select name from tenant_staff($1)",
          [mine.tenantId],
        );
        return result.rows;
      });

      expect(rows).toEqual([{ name: "Milica" }]);
    });
  });

  it("neulogovan posetilac ne sme ni da pozove funkcije", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await asAnon(db, async () => {
        const calls: (() => Promise<unknown>)[] = [
          () => db.query("select * from tenant_staff($1)", [base.tenantId]),
          () => save(db, { tenantId: base.tenantId }),
          () => deactivate(db, base.staffId, base.tenantId),
        ];

        for (const call of calls) {
          await expect(inSavepoint(db, call)).rejects.toThrow(
            /permission denied/i,
          );
        }
      });
    });
  });
});

describe("zakazivanje kod dvoje", () => {
  it("isti termin se zakaže kod obe osobe", async () => {
    // Ovo je ceo smisao druge osobe: sat u kom je jedna zauzeta više ne znači
    // da salon ne radi.
    await withRollback(async (db) => {
      const base = await salon(db);
      const added = await asUser(db, base.userId, () => save(db, { name: "Ana" }));
      const second = (added as { ok: true; id: string }).id;
      const start = await nextMonday(db);

      const results = await asAnon(db, async () => [
        await book(db, {
          slug: base.slug,
          serviceId: base.serviceId,
          startAt: start,
          phone: "+381645551001",
          staffId: base.staffId,
        }),
        await book(db, {
          slug: base.slug,
          serviceId: base.serviceId,
          startAt: start,
          phone: "+381645551002",
          staffId: second,
        }),
      ]);

      expect(results[0]!.ok).toBe(true);
      expect(results[1]!.ok).toBe(true);
    });
  });

  it("zauzeta osoba odbija, iako je druga slobodna", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      await asUser(db, base.userId, () => save(db, { name: "Ana" }));
      const start = await nextMonday(db);

      const result = await asAnon(db, async () => {
        await book(db, {
          slug: base.slug,
          serviceId: base.serviceId,
          startAt: start,
          phone: "+381645551003",
          staffId: base.staffId,
        });
        return book(db, {
          slug: base.slug,
          serviceId: base.serviceId,
          startAt: start,
          phone: "+381645551004",
          staffId: base.staffId,
        });
      });

      expect(result).toEqual({ ok: false, reason: "slot_taken" });
    });
  });

  it("„svejedno mi je“ bira onu koja je stvarno slobodna", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const added = await asUser(db, base.userId, () => save(db, { name: "Ana" }));
      const second = (added as { ok: true; id: string }).id;
      const start = await nextMonday(db);

      const result = await asAnon(db, async () => {
        await book(db, {
          slug: base.slug,
          serviceId: base.serviceId,
          startAt: start,
          phone: "+381645551005",
          staffId: base.staffId,
        });
        return book(db, {
          slug: base.slug,
          serviceId: base.serviceId,
          startAt: start,
          phone: "+381645551006",
          staffId: null,
        });
      });

      expect(result.ok).toBe(true);

      const row = await db.query<{ staff_id: string }>(
        "select staff_id from appointments where id = $1",
        [(result as { ok: true; appointment: { id: string } }).appointment.id],
      );
      expect(row.rows[0]!.staff_id).toBe(second);
    });
  });

  it("izvođač iz drugog salona se ne prihvata", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const theirs = await salon(db);
      const start = await nextMonday(db);

      const result = await asAnon(db, () =>
        book(db, {
          slug: base.slug,
          serviceId: base.serviceId,
          startAt: start,
          phone: "+381645551007",
          staffId: theirs.staffId,
        }),
      );

      expect(result).toEqual({ ok: false, reason: "unknown_service" });
    });
  });

  it("ručni upis poštuje izabranu osobu", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const added = await asUser(db, base.userId, () => save(db, { name: "Ana" }));
      const second = (added as { ok: true; id: string }).id;

      const result = await asUser(db, base.userId, async () => {
        const created = await db.query<{
          result: { ok: true; appointment_id: string } | { ok: false };
        }>(
          "select create_appointment($1, $2, 90, $3, $4, null, $5) as result",
          [
            base.serviceId,
            "2026-09-14T08:00:00Z",
            "Jelena",
            "+381645551008",
            second,
          ],
        );
        return created.rows[0]!.result;
      });

      expect(result.ok).toBe(true);

      const row = await db.query<{ staff_id: string }>(
        "select staff_id from appointments where id = $1",
        [(result as { ok: true; appointment_id: string }).appointment_id],
      );
      expect(row.rows[0]!.staff_id).toBe(second);
    });
  });
});

describe("oblik odgovora se poklapa sa onim što aplikacija očekuje", () => {
  it("tenant_staff prolazi kroz Zod šemu netaknut", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      await asUser(db, base.userId, () => save(db, { name: "Ana" }));

      const rows = await asUser(db, base.userId, async () => {
        const result = await db.query("select * from tenant_staff($1)", [
          base.tenantId,
        ]);
        return result.rows;
      });

      const schema = z.array(
        z.object({ id: z.uuid(), name: z.string(), active: z.boolean() }),
      );
      expect(() => schema.parse(rows)).not.toThrow();
      expect(rows).toHaveLength(2);
    });
  });
});
