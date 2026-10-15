/** Read-only schema inspection of a Supabase project via the Management API. */
import { parseTarget, projectRef, query } from "./mgmt";

const target = parseTarget(process.argv);
const ref = projectRef(target);

const sections: [string, string][] = [
  [
    "Non-system schemas",
    `select nspname as schema from pg_namespace
     where nspname not like 'pg\\_%' and nspname not in ('information_schema')
     order by 1`,
  ],
  [
    "Tables outside Supabase-managed schemas (with row estimates)",
    `select n.nspname as schema, c.relname as table, c.relrowsecurity as rls,
            greatest(c.reltuples, 0)::bigint as est_rows
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r','p') and n.nspname not in
       ('pg_catalog','information_schema','auth','storage','realtime','supabase_functions',
        'extensions','graphql','graphql_public','pgsodium','pgsodium_masks','vault','net',
        'supabase_migrations','cron','pgbouncer','_realtime','_analytics')
     order by 1, 2`,
  ],
  [
    "Views / functions in public & private",
    `select n.nspname as schema, p.proname as name, case p.prokind when 'f' then 'function' when 'p' then 'procedure' else p.prokind::text end as kind
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public','private') order by 1, 2`,
  ],
  [
    "Triggers on auth.users",
    `select tgname, pg_get_triggerdef(t.oid) as def from pg_trigger t
     where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal`,
  ],
  ["Policies", `select schemaname, tablename, policyname, cmd from pg_policies where schemaname not in ('storage','realtime') order by 1,2,3`],
  ["Installed extensions", `select extname, extversion from pg_extension order by 1`],
  ["Storage buckets", `select id, public from storage.buckets order by 1`],
  ["Auth users", `select count(*)::int as users from auth.users`],
  [
    "Recorded migrations",
    `select to_regclass('supabase_migrations.schema_migrations') is not null as has_table`,
  ],
  ["Cron jobs", `select to_regclass('cron.job') is not null as has_cron`],
];

console.log(`Inspecting ${target} project ${ref}\n`);
for (const [title, sql] of sections) {
  try {
    const rows = await query(ref, sql, true);
    console.log(`## ${title} (${rows.length})`);
    if (rows.length) console.table(rows);
  } catch (error) {
    console.log(`## ${title}: ERROR ${(error as Error).message}`);
  }
}

const [hasMigrations] = await query<{ has: boolean }>(
  ref,
  `select to_regclass('supabase_migrations.schema_migrations') is not null as has`,
  true,
);
if (hasMigrations?.has) {
  console.log("## Applied migrations");
  console.table(await query(ref, `select version, name from supabase_migrations.schema_migrations order by version`, true));
}
const [hasCron] = await query<{ has: boolean }>(ref, `select to_regclass('cron.job') is not null as has`, true);
if (hasCron?.has) {
  console.log("## Cron jobs");
  console.table(await query(ref, `select jobid, jobname, schedule, active from cron.job order by jobid`, true));
}
