/**
 * Sets up the Google Sheet sync: which sheet, who imports, and the schedule (pg_cron + pg_net,
 * both free on Supabase). The job fires every 5 minutes and calls the app only when the interval
 * chosen in the app (Imports → Google Sheet sync) has passed. After this, everything else — the
 * sheet, its tabs, how often — can be changed in the app. The cron secret lives only in Vault and, hashed, in
 * public.sheet_sync — never in git, the app's env or this script's output.
 *
 *   pnpm sync:setup --target live --sheet "<sheet link>" --actor <username> [--app-url https://…]
 *   pnpm sync:setup --target live --enable        # start importing (after pnpm sync:sheet --dry-run)
 *   pnpm sync:setup --target live --disable       # pause; nothing is imported until --enable
 *   pnpm sync:setup --target live --rotate-secret # new cron secret
 *
 * The schedule is created disabled. Re-running is safe: values not given are kept.
 */
import { randomBytes } from "node:crypto";
import { parseSheetUrl } from "../src/lib/sheet-sync/fetch";
import { parseTarget, projectRef, query } from "./supabase/mgmt";

const DEFAULT_APP_URL = "https://fcs-crm-sales.vercel.app";
const JOB = "crm-sheet-sync";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const target = parseTarget(process.argv);
const ref = projectRef(target);
const enable = flag("enable");
const disable = flag("disable");
if (enable && disable) throw new Error("Use --enable or --disable, not both.");

const dq = (text: string) => {
  let tag = "s";
  while (text.includes(`$${tag}$`)) tag += "x";
  return `$${tag}$${text}$${tag}$`;
};

const [table] = await query<{ ok: boolean }>(ref, `select to_regclass('public.sheet_sync') is not null as ok`, true);
if (!table?.ok) throw new Error(`public.sheet_sync doesn't exist on ${target}. Run pnpm db:migrate --target ${target} first.`);

const [current] = await query<{ sheet_id: string | null; actor: string | null; has_secret: boolean; enabled: boolean }>(
  ref,
  `select s.sheet_id, p.username as actor, s.cron_secret_sha256 is not null as has_secret, s.enabled
     from public.sheet_sync s left join public.profiles p on p.id = s.actor_id where s.id = 1`,
  true,
);

const updates: string[] = [];
const preamble: string[] = [];

const sheetArg = arg("sheet");
if (sheetArg) {
  const sheet = parseSheetUrl(sheetArg);
  if (!sheet) throw new Error("--sheet must be a Google Sheets link (…/spreadsheets/d/<id>/edit#gid=<tab>).");
  updates.push(`sheet_id = ${dq(sheet.sheetId)}`);
  // A different sheet starts from the top (every tab is found on the next run); leads already in
  // the CRM are still recognised and skipped.
  if (sheet.sheetId !== current?.sheet_id) {
    updates.push("all_tabs = true");
    preamble.push("delete from public.sheet_sync_tabs;");
  }
} else if (!current?.sheet_id) {
  throw new Error('No sheet is set yet. Pass --sheet "<Google Sheets link>".');
}

const actorArg = arg("actor")?.trim().toLowerCase();
if (actorArg) {
  const [actor] = await query<{ id: string; role: string; is_active: boolean }>(
    ref,
    `select id, role, is_active from public.profiles where username = ${dq(actorArg)}`,
    true,
  );
  if (!actor || !actor.is_active || !["admin", "manager"].includes(actor.role)) {
    throw new Error(`@${actorArg} must be an active admin or manager. Synced imports are recorded under this person.`);
  }
  updates.push(`actor_id = '${actor.id}'`);
} else if (!current?.actor) {
  throw new Error("No sync actor is set yet. Pass --actor <username> (an active admin or manager).");
}

const secret = !current?.has_secret || flag("rotate-secret") ? randomBytes(32).toString("base64url") : null;
if (secret) updates.push(`cron_secret_sha256 = encode(sha256(convert_to(${dq(secret)}, 'UTF8')), 'hex')`);
if (enable) updates.push("enabled = true");
if (disable) updates.push("enabled = false");

const appUrl = (arg("app-url") ?? DEFAULT_APP_URL).replace(/\/+$/, "");
if (!/^https:\/\/[^/]+$/.test(appUrl)) throw new Error("--app-url must be the site's https:// origin, e.g. https://fcs-crm-sales.vercel.app");
const endpoint = `${appUrl}/api/sync/sheet`;

const upsertSecret = (name: string, value: string) => `
  if exists (select 1 from vault.secrets where name = ${dq(name)}) then
    perform vault.update_secret((select id from vault.secrets where name = ${dq(name)}), ${dq(value)});
  else
    perform vault.create_secret(${dq(value)}, ${dq(name)});
  end if;`;

// The job does nothing (no HTTP call) while sync is disabled or not due yet. Keep in step with
// supabase/migrations/20261026100000_sheet_sync_tabs.sql.
const command = `
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sheet_sync_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sheet_sync_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
  where exists (
    select 1 from public.sheet_sync
     where id = 1 and enabled
       and (last_started_at is null
            or last_started_at <= now() - make_interval(mins => interval_minutes) + interval '1 minute'))`;

await query(
  ref,
  `create extension if not exists pg_net;
   do $setup$ begin
     ${upsertSecret("sheet_sync_url", endpoint)}
     ${secret ? upsertSecret("sheet_sync_cron_secret", secret) : ""}
   end $setup$;
   ${preamble.join("\n")}
   ${updates.length ? `update public.sheet_sync set ${updates.join(", ")}, updated_at = now() where id = 1;` : ""}
   select cron.schedule(${dq(JOB)}, '*/5 * * * *', ${dq(command)});`,
);

const [after] = await query<{ sheet_id: string; actor: string; enabled: boolean }>(
  ref,
  `select s.sheet_id, p.username as actor, s.enabled
     from public.sheet_sync s join public.profiles p on p.id = s.actor_id where s.id = 1`,
  true,
);
console.log(`Google Sheet sync on ${target} (${ref}):`);
console.log(`  Sheet:    ${after.sheet_id} (tabs and interval are set in the app: Imports → Google Sheet sync)`);
console.log(`  Imports as: @${after.actor}`);
console.log(`  Calls:    ${endpoint} (checked every 5 minutes, runs at the chosen interval)`);
console.log(`  Secret:   ${secret ? "new secret stored in Vault" : "unchanged"}`);
console.log(`  Status:   ${after.enabled ? "ENABLED — new rows are imported" : "disabled (run with --enable after a dry run)"}`);
