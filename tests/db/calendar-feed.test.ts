import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  closePool,
  createClient,
  createPopulatedTenant,
  createService,
  createStaff,
  createTenant,
  createUser,
  insertAppointment,
  inSavepoint,
  withRollback,
} from "./helpers";

afterAll(closePool);

type TokenResult = { ok: true; token?: string } | { ok: false; reason: string };

type FeedRow = {
  tenant_name: string;
  appointment_id: string;
  client_name: string;
  client_phone: string;
  status: string;
};

async function enableFeed(
  db: pg.PoolClient,
  tenantId: string,
): Promise<TokenResult> {
  const result = await db.query<{ result: TokenResult }>(
    "select set_calendar_token($1) as result",
    [tenantId],
  );
  return result.rows[0]!.result;
}

async function disableFeed(
  db: pg.PoolClient,
  tenantId: string,
): Promise<TokenResult> {
  const result = await db.query<{ result: TokenResult }>(
    "select clear_calendar_token($1) as result",
    [tenantId],
  );
  return result.rows[0]!.result;
}

async function readFeed(
  db: pg.PoolClient,
  token: string | null,
): Promise<FeedRow[]> {
  const result = await db.query<FeedRow>("select * from calendar_feed($1)", [
    token,
  ]);
  return result.rows;
}

async function tokenOf(db: pg.PoolClient, tenantId: string): Promise<string> {
  const userId = await createUser(db, tenantId);
  const result = await asUser(db, userId, () => enableFeed(db, tenantId));
  if (!result.ok || !result.token) {
    throw new Error("token nije napravljen");
  }
  return result.token;
}

describe("adresu kalendara pravi samo član salona", () => {
  it("vlasnica pravi adresu za svoj salon", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const userId = await createUser(db, tenantId);

      const result = await asUser(db, userId, () => enableFeed(db, tenantId));

      expect(result).toMatchObject({ ok: true });
    });
  });

  it("vlasnica jednog salona ne može da napravi adresu za tuđi", async () => {
    await withRollback(async (db) => {
      const mine = await createTenant(db);
      const theirs = await createTenant(db);
      const userId = await createUser(db, mine);

      const result = await asUser(db, userId, () => enableFeed(db, theirs));

      expect(result).toEqual({ ok: false, reason: "not_allowed" });
    });
  });

  it("neprijavljen ne sme ni da pozove pravljenje adrese", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);

      await expect(
        inSavepoint(db, () => asAnon(db, () => enableFeed(db, tenantId))),
      ).rejects.toThrow();
    });
  });
});

describe("kalendar se čita samo tačnom adresom", () => {
  it("tačan token vraća termine salona", async () => {
    await withRollback(async (db) => {
      const { tenantId, appointmentId } = await createPopulatedTenant(db);
      const token = await tokenOf(db, tenantId);

      const rows = await asAnon(db, () => readFeed(db, token));

      expect(rows.map((row) => row.appointment_id)).toContain(appointmentId);
    });
  });

  it("netačan token ne vraća ništa", async () => {
    await withRollback(async (db) => {
      const { tenantId } = await createPopulatedTenant(db);
      await tokenOf(db, tenantId);

      const rows = await asAnon(db, () =>
        readFeed(db, "00000000-0000-0000-0000-000000000000"),
      );

      expect(rows).toEqual([]);
    });
  });

  it("prazan token ne vraća ništa", async () => {
    await withRollback(async (db) => {
      const { tenantId } = await createPopulatedTenant(db);
      await tokenOf(db, tenantId);

      expect(await asAnon(db, () => readFeed(db, null))).toEqual([]);
    });
  });

  it("token jednog salona ne pokazuje termine drugog", async () => {
    await withRollback(async (db) => {
      const mine = await createPopulatedTenant(db);
      const theirs = await createPopulatedTenant(db);
      const token = await tokenOf(db, mine.tenantId);

      const rows = await asAnon(db, () => readFeed(db, token));

      expect(rows.map((row) => row.appointment_id)).not.toContain(
        theirs.appointmentId,
      );
    });
  });

  it("gašenje kalendara obara staru adresu", async () => {
    await withRollback(async (db) => {
      const { tenantId } = await createPopulatedTenant(db);
      const token = await tokenOf(db, tenantId);
      const userId = await createUser(db, tenantId);

      await asUser(db, userId, () => disableFeed(db, tenantId));

      expect(await asAnon(db, () => readFeed(db, token))).toEqual([]);
    });
  });

  it("nova adresa obara staru", async () => {
    await withRollback(async (db) => {
      const { tenantId } = await createPopulatedTenant(db);
      const stari = await tokenOf(db, tenantId);
      const novi = await tokenOf(db, tenantId);

      expect(novi).not.toBe(stari);
      expect(await asAnon(db, () => readFeed(db, stari))).toEqual([]);
      expect((await asAnon(db, () => readFeed(db, novi))).length).toBeGreaterThan(0);
    });
  });
});

describe("šta kalendar ne pokazuje", () => {
  it("otkazan termin nestaje iz kalendara", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const staffId = await createStaff(db, tenantId);
      const serviceId = await createService(db, tenantId);
      const clientId = await createClient(db, tenantId);
      const token = await tokenOf(db, tenantId);

      const appointment = await insertAppointment(db, {
        tenantId,
        staffId,
        serviceId,
        clientId,
        startAt: "2026-09-10T08:00:00Z",
      });

      expect(
        (await asAnon(db, () => readFeed(db, token))).map((r) => r.appointment_id),
      ).toContain(appointment.id);

      await db.query(
        "update appointments set status = 'cancelled_by_client' where id = $1",
        [appointment.id],
      );

      expect(
        (await asAnon(db, () => readFeed(db, token))).map((r) => r.appointment_id),
      ).not.toContain(appointment.id);
    });
  });

  it("termin stariji od nedelju dana ne izlazi", async () => {
    await withRollback(async (db) => {
      const tenantId = await createTenant(db);
      const staffId = await createStaff(db, tenantId);
      const serviceId = await createService(db, tenantId);
      const clientId = await createClient(db, tenantId);
      const token = await tokenOf(db, tenantId);

      const old = await db.query<{ id: string }>(
        `insert into appointments
           (tenant_id, staff_id, service_id, client_id, start_at,
            duration_min, buffer_after_min, price_rsd, status, source)
         values ($1, $2, $3, $4, now() - interval '30 days',
                 60, 0, 2500, 'confirmed', 'salon')
         returning id`,
        [tenantId, staffId, serviceId, clientId],
      );

      expect(
        (await asAnon(db, () => readFeed(db, token))).map((r) => r.appointment_id),
      ).not.toContain(old.rows[0]!.id);
    });
  });
});
