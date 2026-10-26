/**
 * One sync run against the database, with the server's secret key (no user session). The lock,
 * the secret check and every write happen in the sheet_sync_* RPCs; see the migration
 * 20261019100000_sheet_sync.sql.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExistingLead } from "../import/duplicates";
import { fetchSheetCsv, listSheetTabs } from "./fetch";
import { batchToken, planSheetSync, SheetSyncError, SYNC_FILE_NAME, SYNC_YEAR_CHOICE, type SyncLookups, type SyncSummary } from "./plan";

type TabState = {
  gid: string;
  name: string;
  position: number;
  enabled: boolean;
  removed: boolean;
  content_hash: string | null;
  processed_through_row: number;
  prefix_hash: string | null;
  has_more: boolean;
  last_checked_at: string | null;
};

type Claim =
  | { claimed: false; reason: "unauthorized" | "disabled" | "not_configured" | "busy" | "not_due" }
  | {
      claimed: true;
      token: string;
      sheet_id: string;
      all_tabs: boolean;
      tabs: TabState[];
      pending_batch_ids: string[];
    };

export type TabResult = {
  gid: string;
  name: string;
  status: "ok" | "unchanged" | "error";
  created: number;
  skipped: number;
  invalid: number;
  error?: string;
};

export type SyncRunResult =
  | { status: "skipped"; reason: Extract<Claim, { claimed: false }>["reason"] }
  | { status: "unchanged"; tabs: TabResult[] }
  | {
      status: "ok";
      created: number;
      skipped: number;
      invalid: number;
      summary: SyncSummary;
      tabs: TabResult[];
      continuesNextRun: boolean;
    }
  | { status: "error"; message: string; tabs?: TabResult[] };

type DbError = { code?: string; message?: string };

/** Download (≤ 20 s) plus planning and staging. */
const RESERVE_FOR_SHEET_MS = 25_000;

/** Errors safe to show staff: our own (CR…) messages; anything else is logged, not shown. */
function describe(error: unknown) {
  if (error instanceof SheetSyncError) return error.message;
  const db = error as DbError;
  if (db?.code?.startsWith("CR") && db.message) return db.message;
  console.error("Sheet sync failed", error);
  return "The sync hit an unexpected error. It will try again on the next run.";
}

async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export function dbLookups(db: SupabaseClient): SyncLookups {
  return {
    async missingKeys(externalIds, fingerprints) {
      const rows = await rpc<{ kind: string; key: string }[]>(db, "sheet_sync_missing_keys", {
        p_external_ids: externalIds,
        p_fingerprints: fingerprints,
      });
      return new Set(rows.map((r) => `${r.kind}:${r.key}`));
    },
    findMatches(keys) {
      return rpc<ExistingLead[]>(db, "sheet_sync_find_matches", {
        p_phones: keys.phones,
        p_external_ids: keys.externalIds,
        p_raw_ids: keys.rawIds,
      });
    },
  };
}

/** Processes a staged batch until done or the deadline; true when nothing is left pending. */
async function processBatch(db: SupabaseClient, token: string, batchId: string, deadline: number) {
  while (Date.now() < deadline) {
    const progress = await rpc<{ pending: number }>(db, "sheet_sync_process", { p_token: token, p_batch_id: batchId, p_limit: 250 });
    if (progress.pending === 0) return true;
  }
  return false;
}

const EMPTY_SUMMARY: SyncSummary = {
  sheetRows: 0,
  considered: 0,
  alreadyInCrm: 0,
  toCreate: 0,
  possibleDuplicates: 0,
  invalid: 0,
  repeatedInSheet: 0,
  remaining: 0,
  rescanned: false,
};

function addSummary(a: SyncSummary, b: SyncSummary): SyncSummary {
  return {
    sheetRows: a.sheetRows + b.sheetRows,
    considered: a.considered + b.considered,
    alreadyInCrm: a.alreadyInCrm + b.alreadyInCrm,
    toCreate: a.toCreate + b.toCreate,
    possibleDuplicates: a.possibleDuplicates + b.possibleDuplicates,
    invalid: a.invalid + b.invalid,
    repeatedInSheet: a.repeatedInSheet + b.repeatedInSheet,
    remaining: a.remaining + b.remaining,
    rescanned: a.rescanned || b.rescanned,
  };
}

/** Tabs to read this run: least recently checked first, so a run that runs out of time doesn't starve the last tabs. */
function dueTabs(tabs: TabState[]) {
  return tabs
    .filter((t) => t.enabled && !t.removed)
    .sort((a, b) => (a.last_checked_at ?? "").localeCompare(b.last_checked_at ?? "") || a.position - b.position);
}

/**
 * One run: finish batches an earlier run left, refresh the sheet's tab list, then read each tab.
 * A tab whose content is unusable (no phone column, …) is recorded on that tab and the rest carry
 * on; the run as a whole fails only when the sheet can't be read at all.
 */
export async function runSheetSync(
  db: SupabaseClient,
  options: {
    secret: string | null;
    manual: boolean;
    deadline: number;
    fetchCsv?: typeof fetchSheetCsv;
    listTabs?: typeof listSheetTabs;
  },
): Promise<SyncRunResult> {
  const claim = await rpc<Claim>(db, "sheet_sync_claim", { p_secret: options.secret, p_manual: options.manual });
  if (!claim.claimed) return { status: "skipped", reason: claim.reason };
  const { token } = claim;
  const fetchCsv = options.fetchCsv ?? fetchSheetCsv;
  const batchIds: string[] = [];
  const results: TabResult[] = [];

  try {
    // Rows an earlier run staged but ran out of time to import, leaving time to check the sheet.
    for (const id of claim.pending_batch_ids) {
      if (!(await processBatch(db, token, id, options.deadline - RESERVE_FOR_SHEET_MS))) break;
    }

    // New, renamed and deleted tabs. If the list can't be read, the tabs already known still sync.
    let tabs = claim.tabs;
    try {
      const listed = await (options.listTabs ?? listSheetTabs)(claim.sheet_id);
      tabs = await rpc<TabState[]>(db, "sheet_sync_tabs_seen", { p_token: token, p_tabs: listed });
    } catch (error) {
      if (!(error instanceof SheetSyncError) || !dueTabs(tabs).length) throw error;
    }
    const due = dueTabs(tabs);
    if (!due.length) throw new SheetSyncError("No tabs are chosen for syncing. Pick tabs under Imports → Google Sheet sync.");

    let summary = EMPTY_SUMMARY;
    let finished = true;
    let deferred = false;
    for (const tab of due) {
      if (Date.now() > options.deadline - RESERVE_FOR_SHEET_MS) {
        deferred = true;
        break;
      }
      const tabBatches: string[] = [];
      try {
        const csv = await fetchCsv(claim.sheet_id, tab.gid);
        const plan = await planSheetSync(
          csv,
          {
            contentHash: tab.content_hash,
            processedThroughRow: tab.processed_through_row,
            prefixHash: tab.prefix_hash,
            hasMore: tab.has_more,
          },
          dbLookups(db),
        );
        if (plan.kind === "unchanged") {
          await rpc(db, "sheet_sync_tab_finish", { p_token: token, p_gid: tab.gid, p_status: "unchanged", p_error: null, p_batch_ids: [] });
          results.push({ gid: tab.gid, name: tab.name, status: "unchanged", created: 0, skipped: 0, invalid: 0 });
          continue;
        }

        for (const rows of plan.chunks) {
          const staged = await rpc<{ batch_id: string }>(db, "sheet_sync_stage", {
            p_token: token,
            p_client_token: batchToken(plan.contentHash, rows[0].row_number, tab.gid),
            p_meta: {
              file_name: SYNC_FILE_NAME,
              sheet_name: tab.name,
              file_sha256: plan.contentHash,
              column_mapping: plan.mapping,
              event_year_choice: SYNC_YEAR_CHOICE,
              total_rows: rows.length,
            },
            p_rows: rows,
          });
          tabBatches.push(staged.batch_id);
          batchIds.push(staged.batch_id);
        }
        // Staged rows are safe in the database from here on; processing can resume on a later run.
        await rpc(db, "sheet_sync_checkpoint", {
          p_token: token,
          p_gid: tab.gid,
          p_content_hash: plan.contentHash,
          p_processed_through_row: plan.processedThroughRow,
          p_prefix_hash: plan.prefixHash,
          p_has_more: plan.hasMore,
        });
        summary = addSummary(summary, plan.summary);
        if (plan.hasMore) deferred = true;

        // Imported before the next tab is planned, so a lead in two tabs is recognised there.
        for (const id of tabBatches) {
          if (!finished || !(await processBatch(db, token, id, options.deadline))) finished = false;
        }
        const counts = await rpc<{ created: number; skipped: number; invalid: number }>(db, "sheet_sync_tab_finish", {
          p_token: token,
          p_gid: tab.gid,
          p_status: "ok",
          p_error: null,
          p_batch_ids: tabBatches,
        });
        results.push({ gid: tab.gid, name: tab.name, status: "ok", ...counts });
      } catch (error) {
        // Only the tab's own content is a tab problem; database and lock errors stop the run.
        if (!(error instanceof SheetSyncError)) throw error;
        await rpc(db, "sheet_sync_tab_finish", { p_token: token, p_gid: tab.gid, p_status: "error", p_error: error.message, p_batch_ids: tabBatches });
        results.push({ gid: tab.gid, name: tab.name, status: "error", created: 0, skipped: 0, invalid: 0, error: error.message });
      }
    }

    const failed = results.filter((r) => r.status === "error");
    if (results.length && failed.length === results.length) {
      throw new SheetSyncError(
        failed.length === 1 && due.length === 1 ? failed[0].error! : `${failed[0].name.trim()}: ${failed[0].error} (${failed.length} tabs failed)`,
      );
    }

    if (!results.some((r) => r.status === "ok")) {
      await rpc(db, "sheet_sync_finish", { p_token: token, p_status: "unchanged", p_error: null, p_batch_ids: [] });
      return { status: "unchanged", tabs: results };
    }
    const counts = await rpc<{ created: number; skipped: number; invalid: number }>(db, "sheet_sync_finish", {
      p_token: token,
      p_status: "ok",
      p_error: null,
      p_batch_ids: batchIds,
    });
    return {
      status: "ok",
      created: counts.created,
      skipped: counts.skipped,
      invalid: counts.invalid,
      summary,
      tabs: results,
      continuesNextRun: !finished || deferred,
    };
  } catch (error) {
    const message = describe(error);
    await rpc(db, "sheet_sync_finish", { p_token: token, p_status: "error", p_error: message, p_batch_ids: batchIds }).catch((e) =>
      console.error("Sheet sync couldn't record its failure", e),
    );
    return { status: "error", message, tabs: results };
  }
}
