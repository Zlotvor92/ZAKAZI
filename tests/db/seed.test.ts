import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { closePool, withRollback } from "./helpers";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const seedPath = path.join(repoRoot, "supabase", "seed.sql");

afterAll(closePool);

type Counts = Record<string, number>;

async function countEverything(
  db: Parameters<typeof withRollback>[0] extends (db: infer T) => unknown ? T : never,
): Promise<Counts> {
  const result = await db.query<{
    tenants: string;
    memberships: string;
    staff: string;
    services: string;
    staff_services: string;
    working_hours: string;
    users: string;
  }>(
    `select (select count(*) from tenants)::text as tenants,
            (select count(*) from memberships)::text as memberships,
            (select count(*) from staff)::text as staff,
            (select count(*) from services)::text as services,
            (select count(*) from staff_services)::text as staff_services,
            (select count(*) from working_hours)::text as working_hours,
            (select count(*) from auth.users)::text as users`,
  );
  const row = result.rows[0]!;
  return {
    tenants: Number(row.tenants),
    memberships: Number(row.memberships),
    staff: Number(row.staff),
    services: Number(row.services),
    staff_services: Number(row.staff_services),
    working_hours: Number(row.working_hours),
    users: Number(row.users),
  };
}

describe("seed", () => {
  it("pravi jedan salon sa vlasnikom, izvođačem, tri usluge i radnim vremenom", async () => {
    const seed = await readFile(seedPath, "utf8");

    await withRollback(async (db) => {
      await db.query(seed);

      expect(await countEverything(db)).toEqual({
        tenants: 1,
        memberships: 1,
        staff: 1,
        services: 3,
        staff_services: 3,
        working_hours: 11,
        users: 1,
      });
    });
  });

  it("radno vreme je podeljena smena pon–pet i jedan komad subotom", async () => {
    const seed = await readFile(seedPath, "utf8");

    await withRollback(async (db) => {
      await db.query(seed);

      const result = await db.query<{
        weekday: number;
        intervals: string;
      }>(
        `select weekday, string_agg(
           to_char(start_time, 'HH24:MI') || '-' || to_char(end_time, 'HH24:MI'),
           ', ' order by start_time
         ) as intervals
         from working_hours group by weekday order by weekday`,
      );

      expect(result.rows).toEqual([
        { weekday: 1, intervals: "09:00-13:00, 16:00-20:00" },
        { weekday: 2, intervals: "09:00-13:00, 16:00-20:00" },
        { weekday: 3, intervals: "09:00-13:00, 16:00-20:00" },
        { weekday: 4, intervals: "09:00-13:00, 16:00-20:00" },
        { weekday: 5, intervals: "09:00-13:00, 16:00-20:00" },
        { weekday: 6, intervals: "09:00-14:00" },
      ]);
    });
  });

  it("drugo pokretanje ne pravi duplikate i ne pravi drugog korisnika", async () => {
    const seed = await readFile(seedPath, "utf8");

    await withRollback(async (db) => {
      await db.query(seed);
      const first = await countEverything(db);

      await db.query(seed);
      const second = await countEverything(db);

      expect(second).toEqual(first);
    });
  });
});
