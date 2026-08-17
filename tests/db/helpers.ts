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

/**
 * Predstavlja se kao ulogovani korisnik do kraja bloka: postavlja JWT
 * tvrdnje koje `auth.uid()` čita i spušta rolu na `authenticated`, jer vlasnik
 * tabele u Postgresu ne podleže RLS-u i test bez toga ne bi ništa dokazao.
 */
export async function asUser<T>(
  db: pg.PoolClient,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await db.query("set local role authenticated");
  try {
    return await fn();
  } finally {
    await db.query("reset role");
    await db.query("select set_config('request.jwt.claims', '', true)");
  }
}

/** Neulogovan posetilac: rola `anon`, bez ijedne JWT tvrdnje. */
export async function asAnon<T>(
  db: pg.PoolClient,
  fn: () => Promise<T>,
): Promise<T> {
  await db.query("set local role anon");
  try {
    return await fn();
  } finally {
    await db.query("reset role");
  }
}

export async function createUser(
  db: pg.PoolClient,
  tenantId: string,
  role: "owner" | "staff" = "owner",
): Promise<string> {
  const result = await db.query<{ id: string }>(
    "insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id",
    [`vlasnik-${unique()}@primer.rs`],
  );
  const userId = result.rows[0]!.id;
  await db.query(
    "insert into memberships (user_id, tenant_id, role) values ($1, $2, $3)",
    [userId, tenantId, role],
  );
  return userId;
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
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into services (tenant_id, name, price_rsd)
     values ($1, $2, $3) returning id`,
    [tenantId, "Gel nokti", 2500],
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

export type TenantFixture = {
  tenantId: string;
  userId: string;
  staffId: string;
  serviceId: string;
  clientId: string;
  appointmentId: string;
};

/** Salon sa po jednim redom u svakoj tabeli, da izolacija ima šta da krije. */
export async function createPopulatedTenant(
  db: pg.PoolClient,
): Promise<TenantFixture> {
  const tenantId = await createTenant(db);
  const userId = await createUser(db, tenantId);
  const staffId = await createStaff(db, tenantId);
  const serviceId = await createService(db, tenantId);
  const clientId = await createClient(db, tenantId);

  await db.query(
    "insert into staff_services (tenant_id, staff_id, service_id) values ($1, $2, $3)",
    [tenantId, staffId, serviceId],
  );
  await db.query(
    `insert into working_hours
       (tenant_id, staff_id, weekday, start_time, end_time, slot_minutes)
     values ($1, $2, 1, '09:00', '12:00', 90)`,
    [tenantId, staffId],
  );
  await db.query(
    `insert into time_off (tenant_id, staff_id, start_at, end_at, reason)
     values ($1, $2, '2026-09-01T08:00:00Z', '2026-09-01T12:00:00Z', 'lekar')`,
    [tenantId, staffId],
  );

  await db.query(
    `insert into blocklist (tenant_id, phone_e164, reason, created_by)
     values ($1, '+381600000001', 'uzastopno ne dolazi', $2)`,
    [tenantId, userId],
  );

  // Red u `appointment_events` se ne upisuje ovde — triger nad `appointments`
  // ga napravi sam, i to je upravo ono što treba da važi i u testovima.
  const appointment = await insertAppointment(db, {
    tenantId,
    staffId,
    serviceId,
    clientId,
    startAt: "2026-09-10T08:00:00Z",
  });

  return { tenantId, userId, staffId, serviceId, clientId, appointmentId: appointment.id };
}
