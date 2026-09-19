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
     on conflict (endpoint) do update
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
