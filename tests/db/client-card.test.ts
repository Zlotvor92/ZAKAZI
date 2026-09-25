import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
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

type Card = {
  client_id: string;
  name: string;
  phone_e164: string;
  notes: string | null;
  completed: number;
  no_show: number;
  cancelled_by_client: number;
  cancelled_by_salon: number;
  upcoming: number;
  last_visit: string | null;
  blocked: boolean;
};

async function salon(db: pg.PoolClient) {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId);
  const clientId = await createClient(db, tenantId);

  return { tenantId, userId, staffId, serviceId, clientId };
}

type Salon = Awaited<ReturnType<typeof salon>>;

async function book(
  db: pg.PoolClient,
  base: Salon,
  startAt: string,
  status:
    | "confirmed"
    | "completed"
    | "no_show"
    | "cancelled_by_client"
    | "cancelled_by_salon",
  clientId = base.clientId,
): Promise<string> {
  const { id } = await insertAppointment(db, {
    tenantId: base.tenantId,
    staffId: base.staffId,
    serviceId: base.serviceId,
    clientId,
    startAt,
    status,
  });
  return id;
}

async function card(
  db: pg.PoolClient,
  userId: string,
  appointmentId: string,
): Promise<Card | null> {
  return asUser(db, userId, async () => {
    const result = await db.query<{ card: Card | null }>(
      "select client_card($1) as card",
      [appointmentId],
    );
    return result.rows[0]!.card;
  });
}

async function saveNotes(
  db: pg.PoolClient,
  userId: string,
  clientId: string,
  notes: string,
) {
  return asUser(db, userId, async () => {
    const result = await db.query<{
      result: { ok: true } | { ok: false; reason: string };
    }>("select set_client_notes($1, $2) as result", [clientId, notes]);
    return result.rows[0]!.result;
  });
}

describe("kartica klijentkinje", () => {
  it("sabira sve termine sa istog broja, po statusu", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      await book(db, base, "2026-01-05T10:00:00+01:00", "completed");
      await book(db, base, "2026-02-05T10:00:00+01:00", "completed");
      await book(db, base, "2026-03-05T10:00:00+01:00", "no_show");
      await book(db, base, "2026-04-06T10:00:00+02:00", "cancelled_by_client");
      await book(db, base, "2026-04-07T10:00:00+02:00", "cancelled_by_salon");
      const upcoming = await book(db, base, "2099-01-05T10:00:00+01:00", "confirmed");

      const result = await card(db, base.userId, upcoming);

      expect(result).toMatchObject({
        client_id: base.clientId,
        notes: null,
        completed: 2,
        no_show: 1,
        cancelled_by_client: 1,
        cancelled_by_salon: 1,
        upcoming: 1,
        blocked: false,
      });
      expect(new Date(result!.last_visit!).toISOString()).toBe(
        "2026-02-05T09:00:00.000Z",
      );
    });
  });

  it("ne meša termine drugih klijentkinja", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const other = await createClient(db, base.tenantId);
      await book(db, base, "2026-01-05T10:00:00+01:00", "completed", other);
      const mine = await book(db, base, "2026-01-06T10:00:00+01:00", "completed");

      const result = await card(db, base.userId, mine);

      expect(result?.completed).toBe(1);
    });
  });

  it("pokazuje da je broj blokiran", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const id = await book(db, base, "2026-01-05T10:00:00+01:00", "no_show");
      await db.query(
        `insert into blocklist (tenant_id, phone_e164)
         select tenant_id, phone_e164 from clients where id = $1`,
        [base.clientId],
      );

      expect((await card(db, base.userId, id))?.blocked).toBe(true);
    });
  });

  it("beleška se čuva, a prazna se briše", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const id = await book(db, base, "2026-01-05T10:00:00+01:00", "completed");

      expect(
        await saveNotes(db, base.userId, base.clientId, "  Alergija na lateks  "),
      ).toEqual({ ok: true });
      expect((await card(db, base.userId, id))?.notes).toBe("Alergija na lateks");

      await saveNotes(db, base.userId, base.clientId, "   ");
      expect((await card(db, base.userId, id))?.notes).toBeNull();
    });
  });

  it("predugačka beleška se odbija", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);

      expect(
        await saveNotes(db, base.userId, base.clientId, "a".repeat(501)),
      ).toEqual({ ok: false, reason: "too_long" });
    });
  });
});

describe("granica salona", () => {
  it("drugi salon ne vidi karticu ni ne menja belešku", async () => {
    await withRollback(async (db) => {
      const mine = await salon(db);
      const theirs = await salon(db);
      const id = await book(db, theirs, "2026-01-05T10:00:00+01:00", "completed");

      expect(await card(db, mine.userId, id)).toBeNull();
      expect(
        await saveNotes(db, mine.userId, theirs.clientId, "Ukradeno"),
      ).toEqual({ ok: false, reason: "not_found" });

      const notes = await db.query<{ notes: string | null }>(
        "select notes from clients where id = $1",
        [theirs.clientId],
      );
      expect(notes.rows[0]!.notes).toBeNull();
    });
  });

  it("neprijavljen posetilac ne može da pozove ni jednu", async () => {
    await withRollback(async (db) => {
      const base = await salon(db);
      const id = await book(db, base, "2026-01-05T10:00:00+01:00", "completed");

      await asAnon(db, async () => {
        await expect(
          inSavepoint(db, () => db.query("select client_card($1)", [id])),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          inSavepoint(db, () =>
            db.query("select set_client_notes($1, 'x')", [base.clientId]),
          ),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });
});
