/**
 * Shows what the next Google Sheet sync would import from each tab, without changing anything.
 *   pnpm sync:sheet --target live                      # dry run against the configured sheet
 *   pnpm sync:sheet --target live --sheet "<link>"     # dry run against another sheet
 *   pnpm sync:sheet --target live --run                # run one real sync now (sync must be enabled)
 * Prints counts and row numbers only — no names or phone numbers.
 */
import { createClient } from "@supabase/supabase-js";
import { fetchSheetCsv, listSheetTabs, parseSheetUrl } from "../src/lib/sheet-sync/fetch";
import { planSheetSync, type SyncState } from "../src/lib/sheet-sync/plan";
import { dbLookups, runSheetSync } from "../src/lib/sheet-sync/run";
import { projectKeys } from "./supabase/keys";
import { parseTarget, projectRef } from "./supabase/mgmt";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const target = parseTarget(process.argv);
const keys = await projectKeys(projectRef(target));
const db = createClient(keys.url, keys.secret, { auth: { persistSession: false, autoRefreshToken: false } });

if (process.argv.includes("--run")) {
  const result = await runSheetSync(db, { secret: null, manual: true, deadline: Date.now() + 120_000 });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "error" ? 1 : 0);
}

const { data: sync, error } = await db.from("sheet_sync").select("sheet_id, enabled, all_tabs").eq("id", 1).single();
if (error) throw new Error(`Couldn't read sheet_sync on ${target}: ${error.message}. Run pnpm db:migrate first.`);
const { data: known } = await db
  .from("sheet_sync_tabs")
  .select("gid, enabled, content_hash, processed_through_row, prefix_hash, has_more");

const override = arg("sheet") ? parseSheetUrl(arg("sheet")!) : null;
if (arg("sheet") && !override) throw new Error("--sheet must be a Google Sheets link.");
const sheetId = override?.sheetId ?? sync.sheet_id;
if (!sheetId) throw new Error('No sheet configured. Pass --sheet "<link>" or set it under Imports → Google Sheet sync.');

const tabs = await listSheetTabs(sheetId);
console.log(`Dry run on ${target} — sheet ${sheetId}, ${tabs.length} tabs (sync is ${sync.enabled ? "enabled" : "disabled"})`);

for (const tab of tabs) {
  const saved = override ? undefined : known?.find((t) => t.gid === tab.gid);
  const syncing = override ? true : saved ? saved.enabled : sync.all_tabs;
  // Another sheet or a new tab is planned from the top; a known tab continues from its saved progress.
  const state: SyncState = saved
    ? { contentHash: saved.content_hash, processedThroughRow: saved.processed_through_row, prefixHash: saved.prefix_hash, hasMore: saved.has_more }
    : { contentHash: null, processedThroughRow: 0, prefixHash: null, hasMore: false };

  console.log(`\n── ${tab.name.trim()} (gid ${tab.gid})${syncing ? "" : " — not synced (unticked)"}`);
  let plan;
  try {
    plan = await planSheetSync(await fetchSheetCsv(sheetId, tab.gid), state, dbLookups(db));
  } catch (e) {
    console.log(`Error: ${(e as Error).message}`);
    continue;
  }
  if (plan.kind === "unchanged") {
    console.log("No change since the last sync: nothing would be imported.");
    continue;
  }

  const rows = plan.chunks.flat();
  const byReason = (pick: (r: (typeof rows)[number]) => boolean) => rows.filter(pick).map((r) => r.row_number);
  const list = (n: number[]) => (n.length ? ` (rows ${n.slice(0, 30).join(", ")}${n.length > 30 ? ", …" : ""})` : "");
  const s = plan.summary;
  console.log(`Sheet rows:                ${s.sheetRows}
Looked at this run:        ${s.considered}${s.rescanned ? " (tab was edited above the last synced row: rechecked)" : ""}
Already in the CRM:        ${s.alreadyInCrm}  → skipped
Would create:              ${s.toCreate}
Possible duplicate events: ${s.possibleDuplicates}  → skipped, listed in the import${list(byReason((r) => r.skip_reason === "sync_possible_duplicate"))}
Repeated within the tab:   ${s.repeatedInSheet}  → skipped
Invalid (no usable phone): ${s.invalid}${list(byReason((r) => r.status === "invalid"))}
Left for later runs:       ${s.remaining}
Batches:                   ${plan.chunks.length} (≤ 1,000 rows each)
Column mapping:            ${Object.entries(plan.mapping).filter(([, h]) => h).map(([k, h]) => (k === h ? k : `${k}←"${h}"`)).join(", ")}`);
}
console.log("\nNothing was changed.");
