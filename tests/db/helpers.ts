import pg from "pg";
import { testDatabaseUrl } from "./globalSetup";

const pool = new pg.Pool({ connectionString: testDatabaseUrl(), max: 4 });

let counter = 0;
function unique(): string {
  counter += 1;
  return String(counter).padStart(6, "0");
}

/**
 * Svaki test radi u transakciji koja se na kraju poništava, pa testovi ne
 * vide izmene jedni drugih i baza se ne mora praviti iznova.
 */
export async function withRollback<T>(
  fn: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("begin");
    return await fn(db);
  } finally {
    await db.query("rollback");
    db.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

let savepointId = 0;

/**
 * Neuspeo upit u Postgresu obara celu transakciju, pa test koji očekuje
 * grešku ne bi mogao ništa da uradi posle nje. Savepoint vraća transakciju
 * u stanje pre pada.
 */
export async function inSavepoint<T>(
  db: pg.PoolClient,
  fn: () => Promise<T>,
): Promise<T> {
  savepointId += 1;
  const name = `sp_${savepointId}`;
  await db.query(`savepoint ${name}`);
  try {
    const result = await fn();
    await db.query(`release savepoint ${name}`);
    return result;
  } catch (error) {
    await db.query(`rollback to savepoint ${name}`);
    throw error;
  }
}

export async function createTenant(db: pg.PoolClient): Promise<string> {
  const slug = `salon-${unique()}`;
  const result = await db.query<{ id: string }>(
    "insert into tenants (slug, name) values ($1, $2) returning id",
    [slug, `Salon ${slug}`],
  );
  return result.rows[0]!.id;
}

export async function createStaff(
  db: pg.PoolClient,
  tenantId: string,
  name = "Milica",
): Promise<string> {
  const result = await db.query<{ id: string }>(
    "insert into staff (tenant_id, name) values ($1, $2) returning id",
    [tenantId, name],
  );
  return result.rows[0]!.id;
}

export async function createService(
  db: pg.PoolClient,
  tenantId: string,
  options: { durationMin?: number; bufferAfterMin?: number } = {},
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into services (tenant_id, name, duration_min, buffer_after_min, price_rsd)
     values ($1, $2, $3, $4, $5) returning id`,
    [
      tenantId,
      "Gel nokti",
      options.durationMin ?? 60,
      options.bufferAfterMin ?? 0,
      2500,
    ],
  );
  return result.rows[0]!.id;
}

export async function createClient(
  db: pg.PoolClient,
  tenantId: string,
  phone = `+3816${unique()}0`,
): Promise<string> {
  const result = await db.query<{ id: string }>(
    "insert into clients (tenant_id, name, phone_e164) values ($1, $2, $3) returning id",
    [tenantId, "Jelena", phone],
  );
  return result.rows[0]!.id;
}

export type AppointmentInput = {
  tenantId: string;
  staffId: string;
  serviceId: string;
  clientId: string;
  startAt: string;
  durationMin?: number;
  bufferAfterMin?: number;
  status?: string;
};

export async function insertAppointment(
  db: pg.PoolClient,
  input: AppointmentInput,
): Promise<{ id: string; endAt: Date }> {
  const result = await db.query<{ id: string; end_at: Date }>(
    `insert into appointments
       (tenant_id, staff_id, service_id, client_id, start_at,
        duration_min, buffer_after_min, price_rsd, status, source)
     values ($1, $2, $3, $4, $5, $6, $7, 2500, $8, 'salon')
     returning id, end_at`,
    [
      input.tenantId,
      input.staffId,
      input.serviceId,
      input.clientId,
      input.startAt,
      input.durationMin ?? 60,
      input.bufferAfterMin ?? 0,
      input.status ?? "confirmed",
    ],
  );
  const row = result.rows[0]!;
  return { id: row.id, endAt: row.end_at };
}
