/**
 * Sets up the Google Sheet sync: which sheet, who imports, and the every-10-minutes schedule
 * (pg_cron + pg_net, both free on Supabase). The cron secret lives only in Vault and, hashed, in
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

const [current] = await query<{ sheet_id: string | null; sheet_gid: string | null; actor: string | null; has_secret: boolean; enabled: boolean }>(
  ref,
  `select s.sheet_id, s.sheet_gid, p.username as actor, s.cron_secret_sha256 is not null as has_secret, s.enabled
     from public.sheet_sync s left join public.profiles p on p.id = s.actor_id where s.id = 1`,
  true,
);

const updates: string[] = [];

const sheetArg = arg("sheet");
if (sheetArg) {
  const sheet = parseSheetUrl(sheetArg);
  if (!sheet) throw new Error("--sheet must be a Google Sheets link (…/spreadsheets/d/<id>/edit#gid=<tab>).");
  updates.push(`sheet_id = ${dq(sheet.sheetId)}`, `sheet_gid = ${sheet.gid ? dq(sheet.gid) : "null"}`);
  // A different sheet or tab starts from the top; leads already in the CRM are still recognised and skipped.
  if (sheet.sheetId !== current?.sheet_id || sheet.gid !== current?.sheet_gid) {
    updates.push("content_hash = null", "prefix_hash = null", "processed_through_row = 0", "has_more = false");
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

// The job does nothing (no HTTP call) while sync is disabled.
const command = `
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sheet_sync_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sheet_sync_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
  where exists (select 1 from public.sheet_sync where id = 1 and enabled)`;

await query(
  ref,
  `create extension if not exists pg_net;
   do $setup$ begin
     ${upsertSecret("sheet_sync_url", endpoint)}
     ${secret ? upsertSecret("sheet_sync_cron_secret", secret) : ""}
   end $setup$;
   ${updates.length ? `update public.sheet_sync set ${updates.join(", ")}, updated_at = now() where id = 1;` : ""}
   select cron.schedule(${dq(JOB)}, '*/10 * * * *', ${dq(command)});`,
);

const [after] = await query<{ sheet_id: string; sheet_gid: string | null; actor: string; enabled: boolean }>(
  ref,
  `select s.sheet_id, s.sheet_gid, p.username as actor, s.enabled
     from public.sheet_sync s join public.profiles p on p.id = s.actor_id where s.id = 1`,
  true,
);
console.log(`Google Sheet sync on ${target} (${ref}):`);
console.log(`  Sheet:    ${after.sheet_id}${after.sheet_gid ? ` (tab gid ${after.sheet_gid})` : " (first tab)"}`);
console.log(`  Imports as: @${after.actor}`);
console.log(`  Calls:    ${endpoint} every 10 minutes`);
console.log(`  Secret:   ${secret ? "new secret stored in Vault" : "unchanged"}`);
console.log(`  Status:   ${after.enabled ? "ENABLED — new rows are imported" : "disabled (run with --enable after a dry run)"}`);
