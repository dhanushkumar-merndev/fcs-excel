/**
 * Decides what one Google Sheet sync run imports. Pure apart from the two database lookups it is
 * given, so the API route, the dry-run script and the tests share it.
 *
 * Cost per run follows the rows that are new, never the sheet's or the CRM's history:
 *  1. Same CSV as last run → nothing to do (no parsing, no lookups).
 *  2. Rows after the last processed row are new. If everything up to that row is unchanged (the
 *     normal case: Meta appends) old rows are not looked at again.
 *  3. If someone edited above that point, old rows are rechecked — but only valid rows with a source
 *     key, and only by an index probe for "is this key already a lead?".
 *  4. What's left goes through the same cleaning and duplicate review as a manual import.
 */
import { createHash } from "node:crypto";
import { cellText, type RawRow } from "../import/cells";
import type { YearChoice } from "../import/dates";
import type { ExistingLead } from "../import/duplicates";
import type { NormalizedRow } from "../import/normalize";
import { ImportFileError, parseCsv } from "../import/parse";
import { buildStagedRows, chunkMatchKeys, matchKeys, normalizeAll, prepareImport, type Decision } from "../import/prepare";
import { autoMapHeaders, MAX_IMPORT_ROWS, missingRequired, TEMPLATE_COLUMNS, type ColumnMapping } from "../import/template";

export class SheetSyncError extends Error {}

/** Progress saved between runs (public.sheet_sync). */
export type SyncState = {
  contentHash: string | null;
  processedThroughRow: number;
  prefixHash: string | null;
  hasMore: boolean;
};

export type SyncLookups = {
  /** The keys ("id:…" / "fp:…") among those given that no lead has yet. */
  missingKeys(externalIds: string[], fingerprints: string[]): Promise<Set<string>>;
  findMatches(keys: ReturnType<typeof matchKeys>): Promise<ExistingLead[]>;
};

/** Yearless event dates ("20 Nov") resolve to the next one after the lead came in — the wizard's suggestion. */
export const SYNC_YEAR_CHOICE: YearChoice = { mode: "after_created" };
export const SYNC_FILE_NAME = "Google Sheet sync";
/** New rows staged per run; a bigger backlog continues on the next run. */
export const MAX_ROWS_PER_RUN = 2000;
const KEYS_PER_LOOKUP = 1000;

export type StagedRow = ReturnType<typeof buildStagedRows>[number];

export type SyncSummary = {
  sheetRows: number;
  /** Rows looked at this run (new rows, plus rechecked old ones after an edit). */
  considered: number;
  alreadyInCrm: number;
  toCreate: number;
  possibleDuplicates: number;
  invalid: number;
  repeatedInSheet: number;
  /** Rows left for the next run. */
  remaining: number;
  rescanned: boolean;
};

export type SyncPlan =
  | { kind: "unchanged" }
  | {
      kind: "changed";
      contentHash: string;
      processedThroughRow: number;
      prefixHash: string;
      hasMore: boolean;
      mapping: ColumnMapping;
      /** Rows to stage, ≤ 1,000 per batch. */
      chunks: StagedRow[][];
      summary: SyncSummary;
    };

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Hash of the header row and every row up to sheet row `through`, as displayed. */
export function prefixHash(headers: string[], rows: RawRow[], through: number) {
  const hash = createHash("sha256").update(JSON.stringify(headers));
  for (const row of rows) {
    if (row.rowNumber > through) break;
    hash.update(`\n${row.rowNumber}${JSON.stringify(headers.map((h) => cellText(row.cells[h])))}`);
  }
  return hash.digest("hex");
}

/** The key that makes a lead unique in the database (Meta lead ID, else the source fingerprint). */
export function sourceKey(row: NormalizedRow) {
  if (!row.valid) return null;
  if (row.lead.external_lead_id) return `id:${row.lead.external_lead_id}`;
  if (row.lead.source_fingerprint) return `fp:${row.lead.source_fingerprint}`;
  return null;
}

/** Deterministic batch token: a retried run with the same sheet content gets the same batch back. */
export function batchToken(contentHash: string, firstRow: number) {
  const h = sha256(`${contentHash}:${firstRow}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function readSheet(csv: string) {
  let sheet;
  try {
    sheet = parseCsv(csv).sheets[0];
  } catch (error) {
    if (error instanceof ImportFileError) throw new SheetSyncError(error.message);
    throw error;
  }
  if (!sheet?.headers.length) throw new SheetSyncError("The sheet is empty: there is no header row.");
  const mapping = autoMapHeaders(sheet.headers, sheet.rows);
  const missing = missingRequired(mapping);
  if (missing.length) {
    const labels = missing.map((k) => TEMPLATE_COLUMNS.find((c) => c.key === k)!.header);
    throw new SheetSyncError(`The sheet has no ${labels.join(" or ")} column, so nothing was imported. Check its header row.`);
  }
  return { headers: sheet.headers, rows: sheet.rows, mapping };
}

export async function planSheetSync(
  csv: string,
  state: SyncState,
  lookups: SyncLookups,
  maxRows = MAX_ROWS_PER_RUN,
): Promise<SyncPlan> {
  const contentHash = sha256(csv);
  if (contentHash === state.contentHash && !state.hasMore) return { kind: "unchanged" };

  const { headers, rows, mapping } = readSheet(csv);
  const through = state.processedThroughRow;
  const appendOnly = through > 0 && state.prefixHash === prefixHash(headers, rows, through);
  const normalized = normalizeAll(rows, mapping, SYNC_YEAR_CHOICE);

  // New rows always; old rows only after an edit above the last processed row, and then only
  // those with a source key (anything else was already imported or reported when it was new).
  const candidates = normalized.filter((r) => r.rowNumber > through || (!appendOnly && sourceKey(r) !== null));

  const keys = candidates.map(sourceKey);
  const ids = [...new Set(keys.filter((k) => k?.startsWith("id:")).map((k) => k!.slice(3)))];
  const fingerprints = [...new Set(keys.filter((k) => k?.startsWith("fp:")).map((k) => k!.slice(3)))];
  const missing = new Set<string>();
  for (let i = 0; i < Math.max(ids.length, fingerprints.length); i += KEYS_PER_LOOKUP) {
    const part = await lookups.missingKeys(ids.slice(i, i + KEYS_PER_LOOKUP), fingerprints.slice(i, i + KEYS_PER_LOOKUP));
    for (const key of part) missing.add(key);
  }
  const fresh = candidates.filter((_, i) => keys[i] === null || missing.has(keys[i]!));

  const batch = fresh.slice(0, maxRows);
  const hasMore = fresh.length > batch.length;
  // With a backlog, continue after the last row taken. (After an edit that can move the marker
  // back; rows between are then rechecked as new, which is safe: known keys are filtered again.)
  const processedThroughRow = hasMore ? batch[batch.length - 1].rowNumber : (rows[rows.length - 1]?.rowNumber ?? 0);

  const existing = new Map<string, ExistingLead>();
  for (const part of chunkMatchKeys(matchKeys(batch))) {
    if (!part.phones.length && !part.externalIds.length && !part.rawIds.length) continue;
    for (const lead of await lookups.findMatches(part)) existing.set(lead.lead_id, lead);
  }
  const leads = [...existing.values()];

  // Nobody reviews a sync: possible duplicate events (same phone, same event) are skipped and
  // stay visible in the batch's row report.
  const decisions: Record<number, Decision> = {};
  for (const r of prepareImport(batch, leads, {}).rows) {
    if (r.status === "pending" && r.review.needsDecision) decisions[r.row.rowNumber] = "skip";
  }
  const plan = prepareImport(batch, leads, decisions);
  // Rows already in the CRM (matched by raw ID + phone, past the key filter) aren't staged again.
  const staged: StagedRow[] = buildStagedRows({ ...plan, rows: plan.rows.filter((r) => r.skipReason !== "exact_duplicate") }).map((r) =>
    decisions[r.row_number] && r.normalized ? { ...r, skip_reason: "sync_possible_duplicate" } : r,
  );

  const chunks: StagedRow[][] = [];
  for (let i = 0; i < staged.length; i += MAX_IMPORT_ROWS) chunks.push(staged.slice(i, i + MAX_IMPORT_ROWS));

  return {
    kind: "changed",
    contentHash,
    processedThroughRow,
    prefixHash: prefixHash(headers, rows, processedThroughRow),
    hasMore,
    mapping,
    chunks,
    summary: {
      sheetRows: rows.length,
      considered: candidates.length,
      alreadyInCrm: candidates.length - fresh.length + plan.rows.filter((r) => r.skipReason === "exact_duplicate").length,
      toCreate: plan.summary.toCreate,
      possibleDuplicates: Object.keys(decisions).length,
      invalid: plan.summary.invalid,
      repeatedInSheet: plan.rows.filter((r) => r.skipReason === "duplicate_in_file").length,
      remaining: fresh.length - batch.length,
      rescanned: through > 0 && !appendOnly,
    },
  };
}
