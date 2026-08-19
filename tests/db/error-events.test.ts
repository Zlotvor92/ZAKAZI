import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  closePool,
  createTenant,
  createUser,
  inSavepoint,
  withRollback,
} from "./helpers";

afterAll(closePool);

type ErrorRow = {
  id: string;
  source: string;
  message: string;
  path: string | null;
  stack: string | null;
};

let counter = 0;

async function makeAdmin(db: pg.PoolClient): Promise<string> {
  counter += 1;
  const result = await db.query<{ id: string }>(
    "insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id",
    [`admin-${counter}@zakazi.rs`],
  );
  const id = result.rows[0]!.id;
  await db.query("insert into platform_owners (user_id) values ($1)", [id]);
  return id;
}

async function log(
  db: pg.PoolClient,
  input: { source?: string; message?: string; path?: string; stack?: string } = {},
): Promise<void> {
  await db.query("select log_error($1, $2, null, $3, $4, null, null)", [
    input.source ?? "server",
    input.message ?? "nešto je puklo",
    input.path ?? "/prijava",
    input.stack ?? null,
  ]);
}

async function readErrors(db: pg.PoolClient): Promise<ErrorRow[]> {
  const result = await db.query<ErrorRow>("select * from recent_errors(50)");
  return result.rows;
}

async function countAll(db: pg.PoolClient): Promise<number> {
  const result = await db.query<{ n: string }>(
    "select count(*) as n from error_events",
  );
  return Number(result.rows[0]!.n);
}

describe("greške upisuje i neprijavljen posetilac", () => {
  it("upis prolazi bez prijave — greška na javnoj strani pogađa baš njega", async () => {
    await withRollback(async (db) => {
      await asAnon(db, () => log(db, { source: "client" }));

      expect(await countAll(db)).toBe(1);
    });
  });

  it("nepoznat izvor se odbacuje", async () => {
    await withRollback(async (db) => {
      await asAnon(db, () => log(db, { source: "izmisljeno" }));

      expect(await countAll(db)).toBe(0);
    });
  });

  it("predugačka poruka se seče umesto da obori upis", async () => {
    await withRollback(async (db) => {
      await asAnon(db, () => log(db, { message: "x".repeat(5000) }));

      const result = await db.query<{ n: number }>(
        "select length(message) as n from error_events",
      );
      expect(result.rows[0]!.n).toBe(500);
    });
  });

  it("prazna poruka dobija zamenu, jer red bez teksta ništa ne govori", async () => {
    await withRollback(async (db) => {
      await asAnon(db, () => log(db, { message: "   " }));

      const result = await db.query<{ message: string }>(
        "select message from error_events",
      );
      expect(result.rows[0]!.message).toBe("bez poruke");
    });
  });

  it("preko šezdeset upisa u minutu se tiho odbacuje", async () => {
    await withRollback(async (db) => {
      for (let i = 0; i < 65; i += 1) {
        await asAnon(db, () => log(db, { message: `greška ${i}` }));
      }

      expect(await countAll(db)).toBe(60);
    });
  });
});

describe("greške čita samo vlasnik platforme", () => {
  it("vlasnica salona ne vidi nijednu grešku", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);
      await log(db, { message: "tajna iz steka" });

      const rows = await asUser(db, userId, () => readErrors(db));

      expect(rows).toEqual([]);
    });
  });

  it("vlasnik platforme vidi sve", async () => {
    await withRollback(async (db) => {
      const adminId = await makeAdmin(db);
      await log(db, { message: "prva" });
      await log(db, { message: "druga" });

      const rows = await asUser(db, adminId, () => readErrors(db));

      expect(rows.map((row) => row.message).sort()).toEqual(["druga", "prva"]);
    });
  });

  it("neprijavljen ne sme ni da pozove čitanje", async () => {
    await withRollback(async (db) => {
      await log(db);

      await expect(
        inSavepoint(db, () => asAnon(db, () => readErrors(db))),
      ).rejects.toThrow();
    });
  });

  it("u tabelu se ne može ni zaviriti direktno", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);
      await log(db);

      await expect(
        inSavepoint(db, () =>
          asUser(db, userId, () => db.query("select * from error_events")),
        ),
      ).rejects.toThrow();
    });
  });

  it("brojač za traku ćuti nečlanu, a broji vlasniku platforme", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);
      const adminId = await makeAdmin(db);
      await log(db);
      await log(db);

      const asOwner = await asUser(db, userId, () =>
        db.query<{ n: number }>("select error_count_last_day() as n"),
      );
      const asAdmin = await asUser(db, adminId, () =>
        db.query<{ n: number }>("select error_count_last_day() as n"),
      );

      expect(asOwner.rows[0]!.n).toBe(0);
      expect(asAdmin.rows[0]!.n).toBe(2);
    });
  });
});
