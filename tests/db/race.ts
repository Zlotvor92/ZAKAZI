import pg from "pg";
import { testDatabaseUrl } from "./globalSetup";

/**
 * Prave paralelne konekcije sa commit-om. `withRollback` ovde ne pomaže: jedna
 * transakcija ne može da se trka sama sa sobom, a trka je upravo ono što se
 * proverava. Podaci se upisuju stvarno i brišu u `cleanup`.
 */
export const racePool = new pg.Pool({
  connectionString: testDatabaseUrl(),
  max: 20,
});

export type Salon = {
  tenantId: string;
  staffId: string;
  serviceId: string;
  slug: string;
};

let counter = 0;

export async function createCommittedSalon(
  slotMinutes = 15,
  serviceMinutes = 15,
): Promise<Salon> {
  counter += 1;
  const slug = `audit-${Date.now().toString(36)}-${counter}`;
  const db = await racePool.connect();
  try {
    const tenant = await db.query<{ id: string }>(
      `insert into tenants (slug, name, booking_horizon_days, min_lead_minutes)
       values ($1, 'Audit salon', 60, 0) returning id`,
      [slug],
    );
    const tenantId = tenant.rows[0]!.id;
    const staff = await db.query<{ id: string }>(
      "insert into staff (tenant_id, name) values ($1, 'Milica') returning id",
      [tenantId],
    );
    const staffId = staff.rows[0]!.id;
    const service = await db.query<{ id: string }>(
      `insert into services (tenant_id, name, duration_min, price_rsd)
       values ($1, 'Manikir', $2, 2000) returning id`,
      [tenantId, serviceMinutes],
    );
    const serviceId = service.rows[0]!.id;
    await db.query(
      "insert into staff_services (tenant_id, staff_id, service_id) values ($1,$2,$3)",
      [tenantId, staffId, serviceId],
    );
    for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
      await db.query(
        `insert into working_hours
           (tenant_id, staff_id, weekday, start_time, end_time, slot_minutes)
         values ($1,$2,$3,'09:00','18:00',$4)`,
        [tenantId, staffId, weekday, slotMinutes],
      );
    }
    return { tenantId, staffId, serviceId, slug };
  } finally {
    db.release();
  }
}

export async function cleanupSalon(salon: Salon): Promise<void> {
  await racePool.query("delete from phone_lookup_attempts where tenant_id=$1", [
    salon.tenantId,
  ]);
  await racePool.query("delete from tenants where id = $1", [salon.tenantId]);
}

export type BookResult = {
  ok: boolean;
  replayed?: boolean;
  reason?: string;
  appointment?: { id: string };
};

export type BookArgs = {
  slug: string;
  serviceId: string;
  startAt: string;
  name?: string;
  phone: string;
  deviceId?: string | null;
  networkHash?: string | null;
  headers?: Record<string, string>;
  requestId?: string | null;
};

/** Poziv kao server (`service_role`), na svojoj konekciji i svojoj transakciji. */
export async function bookAsServer(args: BookArgs): Promise<BookResult> {
  const db = await racePool.connect();
  try {
    await db.query("begin");
    await db.query("set local role service_role");
    if (args.headers) {
      await db.query("select set_config('request.headers', $1, true)", [
        JSON.stringify(args.headers),
      ]);
    }
    const result = await db.query<{ r: BookResult }>(
      "select public_book($1,$2,$3,$4,$5,$6,$7,$8) as r",
      [
        args.slug,
        args.serviceId,
        args.startAt,
        args.name ?? "Test Klijent",
        args.phone,
        args.deviceId ?? null,
        args.networkHash ?? null,
        args.requestId ?? null,
      ],
    );
    await db.query("commit");
    return result.rows[0]!.r;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }
}

/** Datum `daysAhead` dana od danas po Beogradu, u zadato vreme, kao ISO sa pomerajem. */
export async function localInstant(
  daysAhead: number,
  time: string,
): Promise<string> {
  const result = await racePool.query<{ at: string }>(
    `select to_char(
       (((now() at time zone 'Europe/Belgrade')::date + $1::int) + $2::time)
         at time zone 'Europe/Belgrade',
       'YYYY-MM-DD"T"HH24:MI:SSOF') as at`,
    [daysAhead, time],
  );
  return result.rows[0]!.at;
}

/** Brojevi koji prolaze proveru lažnih brojeva, svaki drugačiji. */
export function mobile(index: number): string {
  const tail = String(4173829 + index * 7919).padStart(7, "0").slice(-7);
  return `+38164${tail}`;
}
