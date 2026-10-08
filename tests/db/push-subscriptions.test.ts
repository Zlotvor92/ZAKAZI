import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asUser,
  closePool,
  createTenant,
  createUser,
  inSavepoint,
  withRollback,
} from "./helpers";

afterAll(closePool);

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/primer-uredjaja";

/**
 * Isti poziv koji šalje `savePushSubscription`: PostgREST upsert je
 * `insert ... on conflict do update`, pa mora da prođe i kad red već postoji.
 */
async function saveSubscription(
  db: pg.PoolClient,
  input: { tenantId: string; userId: string; endpoint: string; auth: string },
): Promise<void> {
  await db.query(
    `insert into push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
     values ($1, $2, $3, 'kljuc', $4)
     on conflict (tenant_id, endpoint) do update
     set tenant_id = excluded.tenant_id,
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth`,
    [input.tenantId, input.userId, input.endpoint, input.auth],
  );
}

describe("uključivanje obaveštenja na istom telefonu", () => {
  it("prvi put prolazi", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);

      await asUser(db, userId, () =>
        saveSubscription(db, { tenantId, userId, endpoint: ENDPOINT, auth: "a" }),
      );

      const rows = await db.query("select 1 from push_subscriptions where endpoint = $1", [
        ENDPOINT,
      ]);
      expect(rows.rowCount).toBe(1);
    });
  });

  it("drugi put na istom uređaju ne puca", async () => {
    // Pregledač posle brisanja podataka vrati isti `endpoint`, pa upis pada na
    // granu `do update`. Bez politike za `update` RLS je odbija, i vlasnica
    // zauvek dobija „Uključivanje nije uspelo".
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);

      await asUser(db, userId, () =>
        saveSubscription(db, { tenantId, userId, endpoint: ENDPOINT, auth: "a" }),
      );

      await asUser(db, userId, () =>
        saveSubscription(db, { tenantId, userId, endpoint: ENDPOINT, auth: "b" }),
      );

      const rows = await db.query<{ auth: string }>(
        "select auth from push_subscriptions where endpoint = $1",
        [ENDPOINT],
      );
      expect(rows.rows[0]?.auth).toBe("b");
    });
  });

  it("tuđu pretplatu ne prepisuje", async () => {
    // `endpoint` je jedinstven u celoj tabeli, pa bi bez provere jedan nalog
    // mogao da preuzme uređaj drugog samo tako što pogodi njegov `endpoint`.
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const mine = await createUser(db, tenantId);
      const theirs = await createUser(db, tenantId);

      await asUser(db, theirs, () =>
        saveSubscription(db, {
          tenantId,
          userId: theirs,
          endpoint: ENDPOINT,
          auth: "njihov",
        }),
      );

      await expect(
        inSavepoint(db, () =>
          asUser(db, mine, () =>
            saveSubscription(db, {
              tenantId,
              userId: mine,
              endpoint: ENDPOINT,
              auth: "moj",
            }),
          ),
        ),
      ).rejects.toThrow();

      const rows = await db.query<{ auth: string }>(
        "select auth from push_subscriptions where endpoint = $1",
        [ENDPOINT],
      );
      expect(rows.rows[0]?.auth).toBe("njihov");
    });
  });
});

describe("isti telefon, dva salona istog korisnika", () => {
  it("uključivanje za drugi salon ne prepisuje pretplatu prvog", async () => {
    await withRollback(async (db) => {
      const first = await createTenant(db);
      const second = await createTenant(db);
      const userId = await createUser(db, first);
      await db.query(
        "insert into memberships (user_id, tenant_id, role) values ($1, $2, 'owner')",
        [userId, second],
      );

      // Upis ide preko ključa (salon, endpoint), kao `savePushSubscription`.
      for (const tenantId of [first, second]) {
        await asUser(db, userId, () =>
          db.query(
            `insert into push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
             values ($1, $2, $3, 'kljuc', 'a')
             on conflict (tenant_id, endpoint) do update set auth = excluded.auth`,
            [tenantId, userId, ENDPOINT],
          ),
        );
      }

      const rows = await db.query<{ tenant_id: string }>(
        "select tenant_id from push_subscriptions where endpoint = $1 order by tenant_id",
        [ENDPOINT],
      );
      expect(rows.rows.map((row) => row.tenant_id).sort()).toEqual(
        [first, second].sort(),
      );
    });
  });

  it("gašenje jednog salona ne dira pretplatu drugog", async () => {
    await withRollback(async (db) => {
      const first = await createTenant(db);
      const second = await createTenant(db);
      const userId = await createUser(db, first);
      await db.query(
        "insert into memberships (user_id, tenant_id, role) values ($1, $2, 'owner')",
        [userId, second],
      );

      for (const tenantId of [first, second]) {
        await db.query(
          `insert into push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
           values ($1, $2, $3, 'kljuc', 'a')`,
          [tenantId, userId, ENDPOINT],
        );
      }

      await asUser(db, userId, () =>
        db.query(
          "delete from push_subscriptions where tenant_id = $1 and endpoint = $2",
          [first, ENDPOINT],
        ),
      );

      const rows = await db.query<{ tenant_id: string }>(
        "select tenant_id from push_subscriptions where endpoint = $1",
        [ENDPOINT],
      );
      expect(rows.rows.map((row) => row.tenant_id)).toEqual([second]);
    });
  });

  it("isti salon i isti endpoint ostaju jedinstveni", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);

      await db.query(
        `insert into push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
         values ($1, $2, $3, 'kljuc', 'a')`,
        [tenantId, userId, ENDPOINT],
      );

      await expect(
        inSavepoint(db, () =>
          db.query(
            `insert into push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
             values ($1, $2, $3, 'kljuc', 'b')`,
            [tenantId, userId, ENDPOINT],
          ),
        ),
      ).rejects.toThrow();
    });
  });
});

describe("endpoint mora biti push servis pregledača", () => {
  async function accepted(
    db: pg.PoolClient,
    userId: string,
    tenantId: string,
    endpoint: string,
  ): Promise<boolean> {
    try {
      await inSavepoint(db, () =>
        asUser(db, userId, () =>
          db.query(
            `insert into push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
             values ($1, $2, $3, 'kljuc', 'a')`,
            [tenantId, userId, endpoint],
          ),
        ),
      );
      return true;
    } catch {
      return false;
    }
  }

  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QKC1Muic0H7",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("prima %s", async (endpoint) => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);

      expect(await accepted(db, userId, tenantId, endpoint)).toBe(true);
    });
  });

  it.each([
    "https://attacker.example.test/collect",
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://169.254.169.254/latest/meta-data",
    "https://fcm.googleapis.com@evil.test/x",
    "https://fcm.googleapis.com:8443/x",
    "https://fcm.googleapis.com.evil.test/x",
    "https://evil.test/fcm.googleapis.com/x",
  ])("odbija %s, i direktnim upisom vlasnice", async (endpoint) => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);

      expect(await accepted(db, userId, tenantId, endpoint)).toBe(false);
    });
  });
});
