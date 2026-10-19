/**
 * One sync run against the database, with the server's secret key (no user session). The lock,
 * the secret check and every write happen in the sheet_sync_* RPCs; see the migration
 * 20261019100000_sheet_sync.sql.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExistingLead } from "../import/duplicates";
import { fetchSheetCsv } from "./fetch";
import { batchToken, planSheetSync, SheetSyncError, SYNC_FILE_NAME, SYNC_YEAR_CHOICE, type SyncLookups, type SyncSummary } from "./plan";

type Claim =
  | { claimed: false; reason: "unauthorized" | "disabled" | "not_configured" | "busy" }
  | {
      claimed: true;
      token: string;
      sheet_id: string;
      sheet_gid: string | null;
      content_hash: string | null;
      processed_through_row: number;
      prefix_hash: string | null;
      has_more: boolean;
      pending_batch_ids: string[];
    };

export type SyncRunResult =
  | { status: "skipped"; reason: Extract<Claim, { claimed: false }>["reason"] }
  | { status: "unchanged" }
  | { status: "ok"; created: number; skipped: number; invalid: number; summary: SyncSummary; continuesNextRun: boolean }
  | { status: "error"; message: string };

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

export async function runSheetSync(
  db: SupabaseClient,
  options: { secret: string | null; manual: boolean; deadline: number; fetchCsv?: typeof fetchSheetCsv },
): Promise<SyncRunResult> {
  const claim = await rpc<Claim>(db, "sheet_sync_claim", { p_secret: options.secret, p_manual: options.manual });
  if (!claim.claimed) return { status: "skipped", reason: claim.reason };
  const { token } = claim;
  const batchIds: string[] = [];

  try {
    // Rows an earlier run staged but ran out of time to import, leaving time to check the sheet.
    for (const id of claim.pending_batch_ids) {
      if (!(await processBatch(db, token, id, options.deadline - RESERVE_FOR_SHEET_MS))) break;
    }

    const csv = await (options.fetchCsv ?? fetchSheetCsv)(claim.sheet_id, claim.sheet_gid);
    const plan = await planSheetSync(
      csv,
      {
        contentHash: claim.content_hash,
        processedThroughRow: claim.processed_through_row,
        prefixHash: claim.prefix_hash,
        hasMore: claim.has_more,
      },
      dbLookups(db),
    );
    if (plan.kind === "unchanged") {
      await rpc(db, "sheet_sync_finish", { p_token: token, p_status: "unchanged", p_error: null, p_batch_ids: [] });
      return { status: "unchanged" };
    }

    for (const rows of plan.chunks) {
      const staged = await rpc<{ batch_id: string }>(db, "sheet_sync_stage", {
        p_token: token,
        p_client_token: batchToken(plan.contentHash, rows[0].row_number),
        p_meta: {
          file_name: SYNC_FILE_NAME,
          file_sha256: plan.contentHash,
          column_mapping: plan.mapping,
          event_year_choice: SYNC_YEAR_CHOICE,
          total_rows: rows.length,
        },
        p_rows: rows,
      });
      batchIds.push(staged.batch_id);
    }
    // Staged rows are safe in the database from here on; processing can resume on a later run.
    await rpc(db, "sheet_sync_checkpoint", {
      p_token: token,
      p_content_hash: plan.contentHash,
      p_processed_through_row: plan.processedThroughRow,
      p_prefix_hash: plan.prefixHash,
      p_has_more: plan.hasMore,
    });

    let finished = true;
    for (const id of batchIds) {
      if (!(await processBatch(db, token, id, options.deadline))) {
        finished = false;
        break;
      }
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
      summary: plan.summary,
      continuesNextRun: !finished || plan.hasMore,
    };
  } catch (error) {
    const message = describe(error);
    await rpc(db, "sheet_sync_finish", { p_token: token, p_status: "error", p_error: message, p_batch_ids: batchIds }).catch((e) =>
      console.error("Sheet sync couldn't record its failure", e),
    );
    return { status: "error", message };
  }
}
