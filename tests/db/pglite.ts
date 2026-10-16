/**
 * Local Postgres (PGlite/WASM) with a minimal Supabase shim, used to exercise the real
 * migrations, RLS policies and RPCs without a hosted project.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const MIGRATIONS = resolve(import.meta.dirname, "../../supabase/migrations");

const SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  create schema extensions;
  grant usage on schema extensions to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
  create schema cron;
  create table cron.job (jobname text primary key, schedule text, command text);
  create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint
    language sql as $$
      insert into cron.job values (p_name, p_schedule, p_command)
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command;
      select 1::bigint
    $$;
`;

export function migrationFiles() {
  return readdirSync(MIGRATIONS)
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(resolve(MIGRATIONS, f), "utf8") }));
}

/** Fresh database with the shim and the migrations; stopBefore leaves later ones for applyMigrations. */
export async function createDb({ stopBefore }: { stopBefore?: string } = {}) {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(SHIM);
  await applyMigrations(db, (name) => !stopBefore || name < stopBefore);
  return db;
}

export async function applyMigrations(db: PGlite, include: (name: string) => boolean = () => true) {
  for (const file of migrationFiles().filter((f) => include(f.name))) {
    // pg_cron is not available in WASM; the shim provides cron.schedule.
    const sql = file.sql.replace(/create extension if not exists pg_cron[^;]*;/i, "");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Migration ${file.name} failed: ${(error as Error).message}`);
    }
  }
}

export type Db = Awaited<ReturnType<typeof createDb>>;

/** Runs fn as an authenticated end user (RLS enforced), like a PostgREST request. */
export async function asUser<T>(db: Db, userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${userId ? "authenticated" : "anon"}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ""]);
    return fn(tx);
  });
}

export async function createStaff(db: Db, id: string, role: "admin" | "manager" | "salesperson", name: string) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name.toLowerCase()}@example.test`]);
  await db.query(
    `insert into public.profiles (id, full_name, email, username, role) values ($1, $2, $3, $4, $5)`,
    [id, name, `${name.toLowerCase()}@example.test`, name.toLowerCase(), role],
  );
}
