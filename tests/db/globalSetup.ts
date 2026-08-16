import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

export const ADMIN_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export const TEST_DATABASE = "zakazi_test";

export function testDatabaseUrl(): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${TEST_DATABASE}`;
  return url.toString();
}

async function run(connectionString: string, sql: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

export default async function setup(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${TEST_DATABASE} with (force)`);
    await admin.query(`create database ${TEST_DATABASE}`);
  } finally {
    await admin.end();
  }

  const target = testDatabaseUrl();
  await run(target, await readFile(path.join(here, "bootstrap.sql"), "utf8"));

  const migrationsDir = path.join(repoRoot, "supabase", "migrations");
  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    await run(target, await readFile(path.join(migrationsDir, file), "utf8"));
  }
}
