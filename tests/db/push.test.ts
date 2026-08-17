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

let counter = 0;
function endpoint(): string {
  counter += 1;
  return `https://fcm.googleapis.com/fcm/send/uredjaj-${counter}`;
}

async function subscribe(
  db: pg.PoolClient,
  input: { tenantId: string; userId: string; endpoint?: string },
): Promise<void> {
  await db.query(
    `insert into push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
     values ($1, $2, $3, 'kljuc', 'tajna')`,
    [input.tenantId, input.userId, input.endpoint ?? endpoint()],
  );
}

describe("uređaji koji primaju obaveštenja", () => {
  it("svako vidi samo svoje uređaje", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const her = await createUser(db, tenantId);
      const admin = await createUser(db, tenantId);

      await subscribe(db, { tenantId, userId: her });
      await subscribe(db, { tenantId, userId: admin });

      const seen = await asUser(db, her, async () => {
        const result = await db.query<{ user_id: string }>(
          "select user_id from push_subscriptions",
        );
        return result.rows.map((row) => row.user_id);
      });

      // I vlasnik platforme je član ovog salona, pa bi ga politika po članstvu
      // pustila na tuđi uređaj. Endpoint je tajna: ko ga ima, šalje joj
      // obaveštenja. Zato politika gleda korisnika, ne članstvo.
      expect(seen).toEqual([her]);
    });
  });

  it("ne može se prijaviti uređaj u tuđe ime", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const her = await createUser(db, tenantId);
      const admin = await createUser(db, tenantId);

      await asUser(db, her, async () => {
        await expect(
          inSavepoint(db, () =>
            subscribe(db, { tenantId, userId: admin }),
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });
  });

  it("ne može se prijaviti uređaj u salon u kome nisi", async () => {
    await withRollback(async (db) => {
      const hers = await createTenant(db);
      const theirs = await createTenant(db);
      const her = await createUser(db, hers);

      await asUser(db, her, async () => {
        await expect(
          inSavepoint(db, () =>
            subscribe(db, { tenantId: theirs, userId: her }),
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });
  });

  it("briše se samo svoj uređaj", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const her = await createUser(db, tenantId);
      const admin = await createUser(db, tenantId);
      await subscribe(db, { tenantId, userId: admin });

      const deleted = await asUser(db, her, async () => {
        const result = await db.query("delete from push_subscriptions");
        return result.rowCount;
      });

      expect(deleted).toBe(0);
    });
  });

  it("neulogovan posetilac ne vidi nijedan uređaj", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const her = await createUser(db, tenantId);
      await subscribe(db, { tenantId, userId: her });

      const seen = await asAnon(db, async () => {
        const result = await db.query("select * from push_subscriptions");
        return result.rows;
      });

      expect(seen).toEqual([]);
    });
  });
});

describe("dnevnik poslatih poruka", () => {
  async function logMessage(
    db: pg.PoolClient,
    tenantId: string,
    status = "sent",
  ): Promise<void> {
    await db.query(
      `insert into messages (tenant_id, channel, template, status, cost_estimate)
       values ($1, 'push', 'new_booking', $2, 0)`,
      [tenantId, status],
    );
  }

  it("salon vidi svoje poruke, tuđe ne", async () => {
    await withRollback(async (db) => {
      const hers = await createTenant(db);
      const theirs = await createTenant(db);
      const her = await createUser(db, hers);

      await logMessage(db, hers);
      await logMessage(db, theirs);

      const seen = await asUser(db, her, async () => {
        const result = await db.query<{ tenant_id: string }>(
          "select tenant_id from messages",
        );
        return result.rows.map((row) => row.tenant_id);
      });

      expect(seen).toEqual([hers]);
    });
  });

  it("poruka se ne može podmetnuti kroz API", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const her = await createUser(db, tenantId);

      // Nema politiku za upis: dnevnik piše isključivo server. Da je piše
      // pregledač, „poslato joj je" ne bi bio dokaz nego tvrdnja.
      await asUser(db, her, async () => {
        await expect(
          inSavepoint(db, () => logMessage(db, tenantId)),
        ).rejects.toThrow(/row-level security/i);
      });
    });
  });

  it("nepoznat kanal i nepoznat status se ne upisuju", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);

      await expect(
        inSavepoint(db, () =>
          db.query(
            `insert into messages (tenant_id, channel, template, status)
             values ($1, 'golub', 'new_booking', 'sent')`,
            [tenantId],
          ),
        ),
      ).rejects.toThrow(/messages_channel_known/);

      await expect(
        inSavepoint(db, () => logMessage(db, tenantId, "mozda")),
      ).rejects.toThrow(/messages_status_known/);
    });
  });

  it("cena poruke ne može biti negativna", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);

      await expect(
        inSavepoint(db, () =>
          db.query(
            `insert into messages (tenant_id, channel, template, status, cost_estimate)
             values ($1, 'sms', 'new_booking', 'sent', -1)`,
            [tenantId],
          ),
        ),
      ).rejects.toThrow(/messages_cost_not_negative/);
    });
  });
});
