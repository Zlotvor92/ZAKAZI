import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asServer,
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

describe("greške upisuje server", () => {
  it("upis prolazi za grešku sa javne strane (ruta /api/greske upisuje kao server)", async () => {
    await withRollback(async (db) => {
      await asServer(db, () => log(db, { source: "client" }));

      expect(await countAll(db)).toBe(1);
    });
  });

  it("nepoznat izvor se odbacuje", async () => {
    await withRollback(async (db) => {
      await asServer(db, () => log(db, { source: "izmisljeno" }));

      expect(await countAll(db)).toBe(0);
    });
  });

  it("predugačka poruka se seče umesto da obori upis", async () => {
    await withRollback(async (db) => {
      await asServer(db, () => log(db, { message: "x".repeat(5000) }));

      const result = await db.query<{ n: number }>(
        "select length(message) as n from error_events",
      );
      expect(result.rows[0]!.n).toBe(300);
    });
  });

  it("prazna poruka dobija zamenu, jer red bez teksta ništa ne govori", async () => {
    await withRollback(async (db) => {
      await asServer(db, () => log(db, { message: "   " }));

      const result = await db.query<{ message: string }>(
        "select message from error_events",
      );
      expect(result.rows[0]!.message).toBe("bez poruke");
    });
  });

  it("preko šezdeset serverskih upisa u minutu se tiho odbacuje", async () => {
    await withRollback(async (db) => {
      for (let i = 0; i < 65; i += 1) {
        await asServer(db, () => log(db, { message: `greška ${i}` }));
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

describe("evidenciju prazni samo vlasnik platforme", () => {
  async function clear(db: pg.PoolClient): Promise<number> {
    const result = await db.query<{ n: number }>(
      "select clear_error_events() as n",
    );
    return result.rows[0]!.n;
  }

  it("vlasnik platforme briše sve i dobija koliko je otišlo", async () => {
    await withRollback(async (db) => {
      const adminId = await makeAdmin(db);
      await log(db, { message: "prva" });
      await log(db, { message: "druga" });

      const deleted = await asUser(db, adminId, () => clear(db));

      expect(deleted).toBe(2);
      expect(await countAll(db)).toBe(0);
    });
  });

  it("vlasnica salona ne obriše ništa i ne sazna da je nešto bilo", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);
      await log(db, { message: "tajna iz steka" });

      const deleted = await asUser(db, userId, () => clear(db));

      expect(deleted).toBe(0);
      expect(await countAll(db)).toBe(1);
    });
  });

  it("neprijavljen ne sme ni da pozove brisanje", async () => {
    await withRollback(async (db) => {
      await log(db);

      await expect(
        inSavepoint(db, () => asAnon(db, () => clear(db))),
      ).rejects.toThrow();

      expect(await countAll(db)).toBe(1);
    });
  });

  it("prazna evidencija vraća nulu umesto da pukne", async () => {
    await withRollback(async (db) => {
      const adminId = await makeAdmin(db);

      expect(await asUser(db, adminId, () => clear(db))).toBe(0);
    });
  });
});


describe("zloupotreba upisa", () => {
  it("anon ne može da upiše grešku direktno", async () => {
    await withRollback(async (db) => {
      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () => log(db, { source: "client" })),
        ).rejects.toThrow(/permission denied/);
      });
      expect(await countAll(db)).toBe(0);
    });
  });

  it("ni prijavljena vlasnica ne može da upiše direktno", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);
      await asUser(db, userId, async () => {
        await expect(
          inSavepoint(db, () => log(db, { source: "server" })),
        ).rejects.toThrow(/permission denied/);
      });
    });
  });

  it("klijentske greške: najviše 10 u minutu", async () => {
    await withRollback(async (db) => {
      for (let i = 0; i < 25; i += 1) {
        await asServer(db, () => log(db, { source: "client", message: `c${i}` }));
      }

      const result = await db.query<{ n: number }>(
        "select count(*)::int as n from error_events where source = 'client'",
      );
      expect(result.rows[0]!.n).toBe(10);
    });
  });

  it("poplava klijentskih grešaka ne sme da blokira pravu grešku servera", async () => {
    await withRollback(async (db) => {
      for (let i = 0; i < 200; i += 1) {
        await asServer(db, () =>
          log(db, { source: "client", message: `spam ${i}`, stack: "x".repeat(8000) }),
        );
      }
      await asServer(db, () => log(db, { source: "server", message: "prava greška" }));

      const result = await db.query<{ n: number }>(
        "select count(*)::int as n from error_events where message = 'prava greška'",
      );
      expect(result.rows[0]!.n).toBe(1);
    });
  });

  it("stack se seče na 2000, poruka na 300, putanja na 200", async () => {
    await withRollback(async (db) => {
      await asServer(db, () =>
        log(db, {
          message: "m".repeat(1000),
          stack: "s".repeat(9000),
          path: "/" + "p".repeat(900),
        }),
      );

      const result = await db.query<{ m: number; s: number; p: number }>(
        "select length(message) m, length(stack) s, length(path) p from error_events",
      );
      expect(result.rows[0]).toEqual({ m: 300, s: 2000, p: 200 });
    });
  });

  it("mejl, broj telefona i UUID se brišu iz poruke, putanje i stack-a", async () => {
    await withRollback(async (db) => {
      await asServer(db, () =>
        log(db, {
          message: "Greška za jelena@primer.rs i +381 64 512 3480",
          path: "/api/kalendar/salon/6f1c3a52-0a9e-4a2e-9f0e-0d5b4c1f7a11.ics",
          stack: "at x (0641234567) id 3b1d1c86-3d3c-4b0a-8a16-6f1f5c0a9d33",
        }),
      );

      const result = await db.query<{ message: string; path: string; stack: string }>(
        "select message, path, stack from error_events",
      );
      const row = result.rows[0]!;
      expect(row.message).toBe("Greška za [mejl] i [broj]");
      expect(row.path).toBe("/api/kalendar/salon/[uuid].ics");
      expect(row.stack).toBe("at x ([broj]) id [uuid]");
    });
  });

  it("obične cifre iz stack-a (linije, kolone, kratki brojevi) ostaju", async () => {
    await withRollback(async (db) => {
      await asServer(db, () =>
        log(db, { message: "x", stack: "at f (app/page.js:123:45) chunk 1234-abcd.js" }),
      );

      const result = await db.query<{ stack: string }>("select stack from error_events");
      expect(result.rows[0]!.stack).toBe("at f (app/page.js:123:45) chunk 1234-abcd.js");
    });
  });

  it("evidencija starija od 7 dana se briše pri sledećem upisu", async () => {
    await withRollback(async (db) => {
      await log(db, { message: "stara" });
      await log(db, { message: "skorašnja" });
      await db.query(
        "update error_events set occurred_at = now() - interval '8 days' where message = 'stara'",
      );
      await db.query(
        "update error_events set occurred_at = now() - interval '6 days' where message = 'skorašnja'",
      );

      await log(db, { message: "nova" });

      const result = await db.query<{ message: string }>(
        "select message from error_events order by message",
      );
      expect(result.rows.map((r) => r.message)).toEqual(["nova", "skorašnja"]);
    });
  });
});
