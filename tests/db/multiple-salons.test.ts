import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { dashboardWeekSchema } from "@/lib/db/appointments";
import { tenantSummaryListSchema } from "@/lib/db/tenants";
import {
  asUser,
  closePool,
  createStaff,
  createTenant,
  createUser,
  withRollback,
} from "./helpers";

afterAll(closePool);

type WriteResult =
  | { ok: true; id?: string }
  | { ok: false; reason: string };

/**
 * Dva salona istog vlasnika. `created_at` se postavlja ručno jer sve u
 * testu nastaje u istoj transakciji, pa bi im podrazumevani `now()` bio
 * identičan i „prvi salon" ne bi značio ništa.
 */
async function twoSalons(db: pg.PoolClient) {
  const firstId = await createTenant(db);
  const secondId = await createTenant(db);

  await db.query("update tenants set created_at = $2 where id = $1", [
    firstId,
    "2026-01-01T00:00:00Z",
  ]);
  await db.query("update tenants set created_at = $2 where id = $1", [
    secondId,
    "2026-02-01T00:00:00Z",
  ]);

  const userId = await createUser(db, firstId);
  await db.query(
    "insert into memberships (user_id, tenant_id, role) values ($1, $2, 'owner')",
    [userId, secondId],
  );

  const firstStaffId = await createStaff(db, firstId, "Milica");
  const secondStaffId = await createStaff(db, secondId, "Ana");

  return { firstId, secondId, userId, firstStaffId, secondStaffId };
}

describe("oblik odgovora", () => {
  it("spisak salona je onakav kakav ga aplikacija čita", async () => {
    await withRollback(async (db) => {
      const { userId } = await twoSalons(db);

      const rows = await asUser(db, userId, async () => {
        const result = await db.query("select * from my_tenants()");
        return result.rows;
      });

      expect(() => tenantSummaryListSchema.parse(rows)).not.toThrow();
    });
  });

  it("kalendar je onakav kakav ga aplikacija čita", async () => {
    await withRollback(async (db) => {
      const { firstId, userId } = await twoSalons(db);

      const week = await asUser(db, userId, async () => {
        const result = await db.query<{ result: unknown }>(
          "select dashboard_week(null, $1) as result",
          [firstId],
        );
        return result.rows[0]!.result;
      });

      expect(() => dashboardWeekSchema.parse(week)).not.toThrow();
    });
  });
});

describe("spisak salona", () => {
  it("pokazuje samo salone u kojima je korisnik član", async () => {
    await withRollback(async (db) => {
      const { firstId, secondId, userId } = await twoSalons(db);
      await createTenant(db); // tuđi

      const mine = await asUser(db, userId, async () => {
        const result = await db.query<{ id: string }>("select id from my_tenants()");
        return result.rows.map((row) => row.id);
      });

      expect(mine).toEqual([firstId, secondId]);
    });
  });
});

describe("izbor salona", () => {
  it("prosleđeni salon se poštuje, bez njega se uzima prvi", async () => {
    await withRollback(async (db) => {
      const { firstId, secondId, userId } = await twoSalons(db);

      const resolved = await asUser(db, userId, async () => {
        const result = await db.query<{ a: string | null; b: string | null; c: string | null }>(
          "select resolve_tenant($1) as a, resolve_tenant($2) as b, resolve_tenant(null) as c",
          [firstId, secondId],
        );
        return result.rows[0]!;
      });

      expect(resolved).toEqual({ a: firstId, b: secondId, c: firstId });
    });
  });

  it("tuđi salon se ponaša kao da ne postoji", async () => {
    await withRollback(async (db) => {
      const { userId } = await twoSalons(db);
      const strangerId = await createTenant(db);

      const resolved = await asUser(db, userId, async () => {
        const result = await db.query<{ id: string | null }>(
          "select resolve_tenant($1) as id",
          [strangerId],
        );
        return result.rows[0]!.id;
      });

      expect(resolved).toBeNull();
    });
  });
});

describe("upis ide u izabrani salon", () => {
  it("radno vreme se upisuje izvođaču drugog salona", async () => {
    await withRollback(async (db) => {
      const { secondId, userId, secondStaffId } = await twoSalons(db);

      const saved = await asUser(db, userId, async () => {
        const result = await db.query<{ result: WriteResult }>(
          "select set_working_hours($1::jsonb, $2) as result",
          [
            JSON.stringify([
              { weekday: 1, start_minute: 540, end_minute: 720, slot_minutes: 90 },
            ]),
            secondId,
          ],
        );
        return result.rows[0]!.result;
      });

      expect(saved).toEqual({ ok: true });

      const rows = await db.query<{ staff_id: string; tenant_id: string }>(
        "select staff_id, tenant_id from working_hours",
      );
      expect(rows.rows).toEqual([
        { staff_id: secondStaffId, tenant_id: secondId },
      ]);
    });
  });

  it("odsustvo se upisuje u izabrani salon", async () => {
    await withRollback(async (db) => {
      const { secondId, userId, secondStaffId } = await twoSalons(db);

      const saved = await asUser(db, userId, async () => {
        const result = await db.query<{ result: WriteResult }>(
          "select add_time_off($1, $2, $3, $4) as result",
          [
            "2026-09-01T08:00:00Z",
            "2026-09-01T12:00:00Z",
            "lekar",
            secondId,
          ],
        );
        return result.rows[0]!.result;
      });

      expect(saved).toMatchObject({ ok: true });

      const rows = await db.query<{ staff_id: string; tenant_id: string }>(
        "select staff_id, tenant_id from time_off",
      );
      expect(rows.rows).toEqual([
        { staff_id: secondStaffId, tenant_id: secondId },
      ]);
    });
  });

  it("nova usluga i spisak usluga poštuju izabrani salon", async () => {
    await withRollback(async (db) => {
      const { firstId, secondId, userId } = await twoSalons(db);

      const listed = await asUser(db, userId, async () => {
        await db.query("select upsert_service(null, $1, 120, 3000, $2)", [
          "Nadogradnja trepavica",
          secondId,
        ]);

        const inFirst = await db.query<{ name: string }>(
          "select name from tenant_services($1)",
          [firstId],
        );
        const inSecond = await db.query<{ name: string }>(
          "select name from tenant_services($1)",
          [secondId],
        );
        return {
          first: inFirst.rows.map((row) => row.name),
          second: inSecond.rows.map((row) => row.name),
        };
      });

      expect(listed).toEqual({ first: [], second: ["Nadogradnja trepavica"] });
    });
  });

  it("usluga drugog salona se ne može prepraviti iz prvog", async () => {
    await withRollback(async (db) => {
      const { firstId, secondId, userId } = await twoSalons(db);

      const result = await asUser(db, userId, async () => {
        const created = await db.query<{ result: WriteResult }>(
          "select upsert_service(null, $1, 120, 3000, $2) as result",
          ["Nadogradnja trepavica", secondId],
        );
        const serviceId = (created.rows[0]!.result as { id: string }).id;

        const updated = await db.query<{ result: WriteResult }>(
          "select upsert_service($1, $2, 90, 2500, $3) as result",
          [serviceId, "Korekcija", firstId],
        );
        return updated.rows[0]!.result;
      });

      expect(result).toEqual({ ok: false, reason: "not_found" });
    });
  });

  it("kalendar pokazuje izabrani salon", async () => {
    await withRollback(async (db) => {
      const { firstId, secondId, userId } = await twoSalons(db);

      const names = await asUser(db, userId, async () => {
        const result = await db.query<{ first: { name: string }; second: { name: string } }>(
          `select dashboard_week(null, $1)->'tenant' as first,
                  dashboard_week(null, $2)->'tenant' as second`,
          [firstId, secondId],
        );
        return result.rows[0]!;
      });

      const stored = await db.query<{ id: string; name: string }>(
        "select id, name from tenants where id in ($1, $2)",
        [firstId, secondId],
      );
      const nameOf = (id: string) =>
        stored.rows.find((row) => row.id === id)!.name;

      expect(names.first.name).toBe(nameOf(firstId));
      expect(names.second.name).toBe(nameOf(secondId));
    });
  });

  it("tuđi salon ne otvara ni jedan jedini upis", async () => {
    await withRollback(async (db) => {
      const { userId } = await twoSalons(db);
      const strangerId = await createTenant(db);
      await createStaff(db, strangerId, "Tuđa");

      const results = await asUser(db, userId, async () => {
        const hours = await db.query<{ result: WriteResult }>(
          "select set_working_hours('[]'::jsonb, $1) as result",
          [strangerId],
        );
        const off = await db.query<{ result: WriteResult }>(
          "select add_time_off($1, $2, null, $3) as result",
          ["2026-09-01T08:00:00Z", "2026-09-01T12:00:00Z", strangerId],
        );
        const service = await db.query<{ result: WriteResult }>(
          "select upsert_service(null, 'Gel', 60, 1000, $1) as result",
          [strangerId],
        );
        const week = await db.query<{ result: unknown }>(
          "select dashboard_week(null, $1) as result",
          [strangerId],
        );
        return {
          hours: hours.rows[0]!.result,
          off: off.rows[0]!.result,
          service: service.rows[0]!.result,
          week: week.rows[0]!.result,
        };
      });

      expect(results.hours).toEqual({ ok: false, reason: "no_staff" });
      expect(results.off).toEqual({ ok: false, reason: "no_staff" });
      expect(results.service).toEqual({ ok: false, reason: "not_found" });
      expect(results.week).toBeNull();
    });
  });
});
