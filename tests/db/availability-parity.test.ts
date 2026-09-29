import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { buildAvailability } from "@/lib/domain/availability";
import {
  closePool,
  createClient,
  createService,
  createStaff,
  createTenant,
  insertAppointment,
  withRollback,
} from "./helpers";

/**
 * AUDIT — paritet JS (što se prikazuje) i SQL (što se prihvata).
 *
 * Za svaki petominutni početak u danu pita se oba: da li ga
 * `buildAvailability` nudi, i da li ga baza (`is_bookable_start` + preklapanje
 * sa zauzetim + odsustvo, tačno kao `public_book`) prihvata. Svaka razlika je
 * slučaj u kom frontend laže ili ga backend odbija.
 */

afterAll(closePool);

type Block = { weekday: number; start: string; end: string; slot: number };

async function setup(db: pg.PoolClient, blocks: Block[], overrun: [number, number]) {
  const tenantId = await createTenant(db);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId, 60);
  for (const b of blocks) {
    await db.query(
      `insert into working_hours (tenant_id, staff_id, weekday, start_time, end_time, slot_minutes)
       values ($1,$2,$3,$4,$5,$6)`,
      [tenantId, staffId, b.weekday, b.start, b.end, b.slot],
    );
  }
  await db.query(
    "update tenants set break_overrun_min=$2, shift_overrun_min=$3 where id=$1",
    [tenantId, overrun[0], overrun[1]],
  );
  return { tenantId, staffId, serviceId };
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h! * 60 + m!;
}

/** Mesta koja nudi JS i koja prihvata SQL za jedan datum, kao skupovi UTC milisekundi. */
async function compare(
  db: pg.PoolClient,
  fx: { tenantId: string; staffId: string },
  blocks: Block[],
  overrun: [number, number],
  date: string,
  serviceMinutes: number,
) {
  const busyRows = await db.query<{ s: Date; e: Date }>(
    `select lower(blocked_range) s, upper(blocked_range) e from appointments
      where staff_id=$1 and status in ('pending','confirmed')
     union all select start_at, end_at from time_off where staff_id=$1`,
    [fx.staffId],
  );

  const js = buildAvailability({
    timeZone: "Europe/Belgrade",
    fromDate: date,
    toDate: date,
    blocks: blocks.map((b) => ({
      weekday: b.weekday,
      startMinute: toMinutes(b.start),
      endMinute: toMinutes(b.end),
      slotMinutes: b.slot,
    })),
    busy: busyRows.rows.map((r) => ({ startAt: r.s, endAt: r.e })),
    serviceMinutes,
    now: new Date("2020-01-01T00:00:00Z"),
    minLeadMin: 0,
    breakOverrunMin: overrun[0],
    shiftOverrunMin: overrun[1],
  })[0]!.slots.map((s) => s.startAt.getTime());

  const sqlRows = await db.query<{ ms: string }>(
    `with cand as (
       select (($2::date + make_interval(mins => m))::timestamp at time zone 'Europe/Belgrade') as at
         from generate_series(0, 1435, 5) m
     )
     select (extract(epoch from at) * 1000)::bigint as ms
       from cand
      where is_bookable_start($1, 'Europe/Belgrade', at, $3)
        and not exists (
          select 1 from appointments a
           where a.staff_id=$1 and a.status in ('pending','confirmed')
             and a.blocked_range && tstzrange(at, at + make_interval(mins => $3), '[)'))
        and not exists (
          select 1 from time_off t
           where t.staff_id=$1 and tstzrange(t.start_at, t.end_at, '[)') && tstzrange(at, at + make_interval(mins => $3), '[)'))
      order by at`,
    [fx.staffId, date, serviceMinutes],
  );
  const sql = sqlRows.rows.map((r) => Number(r.ms));

  const jsSet = new Set(js);
  const sqlSet = new Set(sql);
  return {
    onlyJs: js.filter((x) => !sqlSet.has(x)).map((x) => new Date(x).toISOString()),
    onlySql: sql.filter((x) => !jsSet.has(x)).map((x) => new Date(x).toISOString()),
    count: js.length,
  };
}

const SPLIT: Block[] = [1, 2, 3, 4, 5, 6, 7].flatMap((weekday) => [
  { weekday, start: "09:00", end: "13:00", slot: 60 },
  { weekday, start: "16:00", end: "20:00", slot: 60 },
]);

// 2026-10-25 je nedelja povratka na zimsko (03:00 → 02:00);
// 2027-03-28 je nedelja prelaska na letnje (02:00 → 03:00).
const DATES = [
  "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26",
  "2027-03-26", "2027-03-27", "2027-03-28", "2027-03-29",
];

describe("paritet JS ↔ SQL", () => {
  for (const [break_, shift] of [[0, 0], [30, 30], [120, 0]] as [number, number][]) {
    it(`podeljena smena 09–13 / 16–20, tolerancija pauza ${break_} min, kraj dana ${shift} min, oko obe promene sata`, async () => {
      await withRollback(async (db) => {
        const fx = await setup(db, SPLIT, [break_, shift]);
        const client = await createClient(db, fx.tenantId);
        // Jedan zauzet termin u svakom danu, i jedno odsustvo — da se proveri i zauzeto.
        for (const date of DATES) {
          await insertAppointment(db, {
            tenantId: fx.tenantId, staffId: fx.staffId, serviceId: fx.serviceId, clientId: client,
            startAt: (await db.query<{ t: string }>(
              "select (($1::date + time '10:00') at time zone 'Europe/Belgrade')::text as t", [date])).rows[0]!.t,
            durationMin: 90,
          });
        }
        await db.query(
          `insert into time_off (tenant_id, staff_id, start_at, end_at)
           values ($1,$2,('2026-10-25 17:00'::timestamp at time zone 'Europe/Belgrade'),('2026-10-25 18:30'::timestamp at time zone 'Europe/Belgrade'))`,
          [fx.tenantId, fx.staffId],
        );

        for (const minutes of [30, 60, 90, 150]) {
          for (const date of DATES) {
            const diff = await compare(db, fx, SPLIT, [break_, shift], date, minutes);
            expect({ date, minutes, onlyJs: diff.onlyJs, onlySql: diff.onlySql }).toEqual({
              date, minutes, onlyJs: [], onlySql: [],
            });
            // Da paritet ne prolazi zato što obe strane vraćaju prazno.
            if (minutes <= 60) {
              expect(diff.count).toBeGreaterThan(0);
            }
          }
        }
      });
    });
  }

  it("podeljena smena: 13:00–16:00 se nikad ne nudi, ni u JS ni u SQL", async () => {
    await withRollback(async (db) => {
      const fx = await setup(db, SPLIT, [0, 0]);
      const diff = await compare(db, fx, SPLIT, [0, 0], "2026-11-02", 60);
      expect(diff.onlyJs).toEqual([]);
      expect(diff.onlySql).toEqual([]);
      const slots = await db.query<{ h: string }>(
        `select to_char(at at time zone 'Europe/Belgrade','HH24:MI') h from (
           select (('2026-11-02'::date + make_interval(mins => m))::timestamp at time zone 'Europe/Belgrade') at
             from generate_series(0,1435,5) m) c
          where is_bookable_start($1,'Europe/Belgrade',at,60)`,
        [fx.staffId],
      );
      expect(slots.rows.map((r) => r.h)).toEqual([
        "09:00", "10:00", "11:00", "12:00", "16:00", "17:00", "18:00", "19:00",
      ]);
    });
  });

  it("blok preko ponoći-do-ponoći (00:00–24:00) na dan prelaska na letnje vreme", async () => {
    await withRollback(async (db) => {
      const blocks: Block[] = [{ weekday: 7, start: "00:00", end: "24:00", slot: 60 }];
      const fx = await setup(db, blocks, [0, 0]);
      const diff = await compare(db, fx, blocks, [0, 0], "2027-03-28", 60);
      expect(diff.onlyJs).toEqual([]);
      expect(diff.onlySql).toEqual([]);
    });
  });
});

describe("buffer", () => {
  it("usluga nema buffer_after_min: kolona ne postoji na services", async () => {
    await withRollback(async (db) => {
      const cols = await db.query(
        "select column_name from information_schema.columns where table_name='services' and column_name like '%buffer%'",
      );
      expect(cols.rowCount).toBe(0);
    });
  });

  it("public_book uvek upisuje buffer_after_min = 0, pa 60 min + 15 min buffer nije moguće podesiti", async () => {
    // Za 10:00–11:00 sledeći slobodan je 11:00 (mreža), ne 11:15.
    await withRollback(async (db) => {
      const blocks: Block[] = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "09:00", end: "18:00", slot: 60 }));
      const fx = await setup(db, blocks, [0, 0]);
      const client = await createClient(db, fx.tenantId);
      await insertAppointment(db, {
        tenantId: fx.tenantId, staffId: fx.staffId, serviceId: fx.serviceId, clientId: client,
        startAt: "2026-11-02T09:00:00Z", durationMin: 60,
      });
      const diff = await compare(db, fx, blocks, [0, 0], "2026-11-02", 60);
      expect(diff).toMatchObject({ onlyJs: [], onlySql: [] });
    });
  });

  it("ako red ipak ima buffer_after_min > 0 (kolona na appointments), baza i JS ga poštuju: 11:00 zauzeto, 11:15 slobodno", async () => {
    await withRollback(async (db) => {
      const blocks: Block[] = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "09:00", end: "18:00", slot: 60 }));
      const fx = await setup(db, blocks, [0, 0]);
      const client = await createClient(db, fx.tenantId);
      await insertAppointment(db, {
        tenantId: fx.tenantId, staffId: fx.staffId, serviceId: fx.serviceId, clientId: client,
        startAt: "2026-11-02T09:00:00Z", durationMin: 60, bufferAfterMin: 15, // 10:00–11:00 CET, blokirano do 11:15
      });
      const diff = await compare(db, fx, blocks, [0, 0], "2026-11-02", 60);
      expect(diff).toMatchObject({ onlyJs: [], onlySql: [] });

      const at = (t: string) =>
        db.query<{ ok: boolean }>(
          `select is_bookable_start($1,'Europe/Belgrade',('2026-11-02 ${t}'::timestamp at time zone 'Europe/Belgrade'),60)
              and not exists (select 1 from appointments a where a.staff_id=$1 and a.status='confirmed'
                 and a.blocked_range && tstzrange(('2026-11-02 ${t}'::timestamp at time zone 'Europe/Belgrade'),
                     ('2026-11-02 ${t}'::timestamp at time zone 'Europe/Belgrade') + interval '60 minutes','[)')) as ok`,
          [fx.staffId],
        );
      expect((await at("11:00")).rows[0]!.ok).toBe(false);
      expect((await at("11:15")).rows[0]!.ok).toBe(true);
    });
  });
});
