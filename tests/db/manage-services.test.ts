import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { serviceListSchema } from "@/lib/db/services";
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

type WriteResult = { ok: true; id: string } | { ok: false; reason: string };
type RemoveResult =
  | { ok: true; outcome: "deleted" | "deactivated" }
  | { ok: false; reason: string };

async function salon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);

  return { tenantId, userId, staffId };
}

async function save(
  db: pg.PoolClient,
  input: {
    id?: string | null;
    name?: string;
    durationMin?: number;
    priceRsd?: number;
  } = {},
): Promise<WriteResult> {
  const result = await db.query<{ result: WriteResult }>(
    "select upsert_service($1, $2, $3, $4) as result",
    [
      input.id ?? null,
      input.name ?? "Nadogradnja trepavica",
      input.durationMin ?? 120,
      input.priceRsd ?? 3500,
    ],
  );
  return result.rows[0]!.result;
}

async function remove(
  db: pg.PoolClient,
  id: string,
): Promise<RemoveResult> {
  const result = await db.query<{ result: RemoveResult }>(
    "select remove_service($1) as result",
    [id],
  );
  return result.rows[0]!.result;
}

describe("salon unosi svoje usluge", () => {
  it("nova usluga se upisuje sa trajanjem i cenom", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      const result = await asUser(db, base.userId, () => save(db));

      expect(result.ok).toBe(true);

      const row = await db.query<{
        name: string;
        duration_min: number;
        price_rsd: number;
        active: boolean;
      }>(
        "select name, duration_min, price_rsd, active from services where tenant_id = $1",
        [base.tenantId],
      );
      expect(row.rows[0]).toEqual({
        name: "Nadogradnja trepavica",
        duration_min: 120,
        price_rsd: 3500,
        active: true,
      });
    });
  });

  it("nova usluga se sama veže za izvođača, inače je klijent ne bi video", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      const created = await asUser(db, base.userId, () => save(db));
      const id = (created as { ok: true; id: string }).id;

      const link = await db.query(
        "select 1 from staff_services where service_id = $1 and staff_id = $2",
        [id, base.staffId],
      );
      expect(link.rowCount).toBe(1);
    });
  });

  it("izmena menja postojeću umesto da pravi novu", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const id = await createService(db, base.tenantId, 90);

      await asUser(db, base.userId, () =>
        save(db, { id, name: "Korekcija trepavica", durationMin: 90, priceRsd: 2200 }),
      );

      const rows = await db.query<{ name: string; duration_min: number }>(
        "select name, duration_min from services where tenant_id = $1",
        [base.tenantId],
      );
      expect(rows.rows).toEqual([
        { name: "Korekcija trepavica", duration_min: 90 },
      ]);
    });
  });

  it("prazan naziv, besmisleno trajanje i cena se odbijaju", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      await asUser(db, base.userId, async () => {
        expect(await save(db, { name: "   " })).toEqual({
          ok: false,
          reason: "invalid_name",
        });
        expect(await save(db, { durationMin: 0 })).toEqual({
          ok: false,
          reason: "invalid_duration",
        });
        expect(await save(db, { priceRsd: -1 })).toEqual({
          ok: false,
          reason: "invalid_price",
        });
      });
    });
  });
});

describe("uklanjanje usluge", () => {
  it("neiskorišćena usluga se briše", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const id = await createService(db, base.tenantId);

      const result = await asUser(db, base.userId, () => remove(db, id));

      expect(result).toEqual({ ok: true, outcome: "deleted" });
      const left = await db.query("select 1 from services where id = $1", [id]);
      expect(left.rowCount).toBe(0);
    });
  });

  it("usluga na kojoj visi termin se gasi, ne briše", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const serviceId = await createService(db, base.tenantId);
      const clientId = await createClient(db, base.tenantId);
      await insertAppointment(db, {
        tenantId: base.tenantId,
        staffId: base.staffId,
        serviceId,
        clientId,
        startAt: "2026-09-14T08:00:00Z",
      });

      const result = await asUser(db, base.userId, () => remove(db, serviceId));

      expect(result).toEqual({ ok: true, outcome: "deactivated" });

      const row = await db.query<{ active: boolean }>(
        "select active from services where id = $1",
        [serviceId],
      );
      expect(row.rows[0]!.active).toBe(false);
    });
  });

  it("ugašena usluga nestaje iz spiska", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const id = await createService(db, base.tenantId);
      await db.query("update services set active = false where id = $1", [id]);

      const listed = await asUser(db, base.userId, () =>
        db.query("select id from tenant_services()"),
      );

      expect(listed.rowCount).toBe(0);
    });
  });
});

describe("granica salona", () => {
  it("vlasnica ne menja tuđu uslugu", async () => {
    await withRollback(async (db) => {
      const mine = await salon(db);
      const theirs = await salon(db);
      const id = await createService(db, theirs.tenantId);

      const result = await asUser(db, mine.userId, () =>
        save(db, { id, name: "Ukradeno" }),
      );

      expect(result).toEqual({ ok: false, reason: "not_found" });
    });
  });

  it("vlasnica ne uklanja tuđu uslugu", async () => {
    await withRollback(async (db) => {
      const mine = await salon(db);
      const theirs = await salon(db);
      const id = await createService(db, theirs.tenantId);

      const result = await asUser(db, mine.userId, () => remove(db, id));

      expect(result).toEqual({ ok: false, reason: "not_found" });

      const left = await db.query("select 1 from services where id = $1", [id]);
      expect(left.rowCount).toBe(1);
    });
  });

  it("neulogovan posetilac ne sme ni da pozove funkcije", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const id = await createService(db, base.tenantId);

      await asAnon(db, async () => {
        await expect(inSavepoint(db, () => save(db))).rejects.toThrow(
          /permission denied/i,
        );
        await expect(inSavepoint(db, () => remove(db, id))).rejects.toThrow(
          /permission denied/i,
        );
      });
    });
  });
});

describe("oblik odgovora se poklapa sa onim što aplikacija očekuje", () => {
  it("tenant_services prolazi kroz Zod šemu netaknut", async () => {
    // Bez ove provere promena kolone u bazi obara ekran podešavanja tek u
    // pregledaču, a TypeScript je ne vidi jer je Zod provera u toku rada.
    await withRollback(async (db) => {
      const base = await salon(db);
      await createService(db, base.tenantId, 120);

      const rows = await asUser(db, base.userId, async () => {
        const result = await db.query("select * from tenant_services()");
        return result.rows;
      });

      expect(rows).toHaveLength(1);
      expect(() => serviceListSchema.parse(rows)).not.toThrow();
    });
  });
});
