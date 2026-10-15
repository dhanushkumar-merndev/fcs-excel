/**
 * Applies supabase/migrations/*.sql in order, each in its own transaction, recording them in
 * supabase_migrations.schema_migrations (Supabase CLI compatible). Already-applied versions are skipped.
 *   pnpm db:migrate --target staging|live [--dry-run]
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot } from "./env";
import { parseTarget, projectRef, query } from "./mgmt";

const target = parseTarget(process.argv);
const dryRun = process.argv.includes("--dry-run");
const ref = projectRef(target);
const dir = resolve(repoRoot, "supabase/migrations");

const files = readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();

await query(
  ref,
  `create schema if not exists supabase_migrations;
   create table if not exists supabase_migrations.schema_migrations (
     version text primary key, statements text[], name text);`,
);
const applied = new Set(
  (await query<{ version: string }>(ref, `select version from supabase_migrations.schema_migrations`, true)).map(
    (r) => r.version,
  ),
);

const dollarQuote = (text: string) => {
  let tag = "mig";
  while (text.includes(`$${tag}$`)) tag += "x";
  return `$${tag}$${text}$${tag}$`;
};

console.log(`Target: ${target} (${ref})`);
for (const file of files) {
  const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
  const name = rest.join("_");
  if (applied.has(version)) {
    console.log(`  ✓ ${file} (already applied)`);
    continue;
  }
  if (dryRun) {
    console.log(`  • ${file} (pending)`);
    continue;
  }
  const sql = readFileSync(resolve(dir, file), "utf8");
  const wrapped = `begin;
${sql}
;
insert into supabase_migrations.schema_migrations (version, name, statements)
values (${dollarQuote(version)}, ${dollarQuote(name)}, array[${dollarQuote(sql)}]);
commit;`;
  process.stdout.write(`  → ${file} … `);
  try {
    await query(ref, wrapped);
    console.log("applied");
  } catch (error) {
    console.log("FAILED");
    console.error((error as Error).message);
    process.exit(1);
  }
}
console.log(dryRun ? "Dry run complete." : "Migrations up to date.");
