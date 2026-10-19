import type { RawRow } from "./cells";
import type { YearChoice } from "./dates";
import { reviewDuplicates, type DuplicateReview, type ExistingLead } from "./duplicates";
import { normalizeRow, type NormalizedRow } from "./normalize";
import type { ColumnMapping } from "./template";

export type Decision = "import" | "skip";

export type PreparedRow = {
  row: NormalizedRow;
  review: DuplicateReview;
  /** Final outcome before saving */
  status: "pending" | "invalid" | "skipped";
  decision: Decision;
  skipReason: string | null;
};

export type PreparedImport = {
  rows: PreparedRow[];
  summary: {
    total: number;
    toCreate: number;
    invalid: number;
    skippedExact: number;
    skippedByChoice: number;
    needsReview: number;
    withWarnings: number;
    undecided: number;
  };
  yearless: number;
};

/** Phones and IDs to look up in the database for duplicate review. */
export function matchKeys(rows: NormalizedRow[]) {
  const phones = new Set<string>();
  const ids = new Set<string>();
  const rawIds = new Set<string>();
  for (const r of rows) {
    if (!r.valid) continue;
    if (r.lead.phone_e164) phones.add(r.lead.phone_e164);
    if (r.lead.external_lead_id) ids.add(r.lead.external_lead_id);
    else if (r.lead.external_lead_id_raw) rawIds.add(r.lead.external_lead_id_raw);
  }
  return { phones: [...phones], externalIds: [...ids], rawIds: [...rawIds] };
}

/** Splits lookup keys into requests of at most `size` values per list (the matches API limit). */
export function chunkMatchKeys(keys: ReturnType<typeof matchKeys>, size = 1000) {
  const count = Math.max(1, Math.ceil(Math.max(keys.phones.length, keys.externalIds.length, keys.rawIds.length) / size));
  return Array.from({ length: count }, (_, i) => ({
    phones: keys.phones.slice(i * size, (i + 1) * size),
    externalIds: keys.externalIds.slice(i * size, (i + 1) * size),
    rawIds: keys.rawIds.slice(i * size, (i + 1) * size),
  }));
}

export function normalizeAll(rows: RawRow[], mapping: ColumnMapping, yearChoice: YearChoice) {
  return rows.map((r) => normalizeRow(r, mapping, yearChoice));
}

/** Row keys of sheet i (0-based) start at (i + 1) × stride; no worksheet has 10 million rows. */
export const SHEET_ROW_STRIDE = 10_000_000;

export type SheetInput = { name: string; rows: RawRow[]; mapping: ColumnMapping };

/**
 * Cleans several sheets as one preview. Each sheet keeps its own column mapping, and row keys are
 * made unique across sheets so duplicates are found between sheets too. A single sheet keeps its
 * plain spreadsheet row numbers.
 */
export function normalizeSheets(sheets: SheetInput[], yearChoice: YearChoice): NormalizedRow[] {
  if (sheets.length === 1) return normalizeAll(sheets[0].rows, sheets[0].mapping, yearChoice);
  return sheets.flatMap((s, i) =>
    normalizeAll(s.rows, s.mapping, yearChoice).map((r) => ({
      ...r,
      rowNumber: (i + 1) * SHEET_ROW_STRIDE + r.rowNumber,
      sheet: s.name,
      sourceRow: r.rowNumber,
    })),
  );
}

/** The decisions that belong to sheet `index`, keyed by its own spreadsheet rows (as the server expects). */
export function decisionsForSheet(decisions: Record<number, Decision>, index: number, sheetCount: number): Record<number, Decision> {
  if (sheetCount === 1) return decisions;
  const base = (index + 1) * SHEET_ROW_STRIDE;
  return Object.fromEntries(
    Object.entries(decisions)
      .map(([key, d]) => [Number(key) - base, d] as const)
      .filter(([row]) => row > 0 && row < SHEET_ROW_STRIDE),
  );
}

/** Per-sheet counts of a combined plan, for the confirmation screen. */
export function summarizeBySheet(plan: PreparedImport) {
  const bySheet = new Map<string, { sheet: string; total: number; toCreate: number; skipped: number; invalid: number }>();
  for (const r of plan.rows) {
    const key = r.row.sheet ?? "";
    const s = bySheet.get(key) ?? { sheet: key, total: 0, toCreate: 0, skipped: 0, invalid: 0 };
    s.total++;
    if (r.status === "pending") s.toCreate++;
    else if (r.status === "invalid") s.invalid++;
    else s.skipped++;
    bySheet.set(key, s);
  }
  return [...bySheet.values()];
}

/**
 * Combines validation, duplicate review and the reviewer's decisions into the final plan.
 * Shared by the preview (browser) and the authoritative server-side preparation.
 */
export function prepareImport(
  normalized: NormalizedRow[],
  existing: ExistingLead[],
  decisions: Record<number, Decision>,
): PreparedImport {
  const reviews = reviewDuplicates(normalized, existing);
  const rows: PreparedRow[] = normalized.map((row) => {
    const review = reviews.get(row.rowNumber)!;
    if (!row.valid) return { row, review, status: "invalid", decision: "skip", skipReason: null };
    if (review.forcedSkip) return { row, review, status: "skipped", decision: "skip", skipReason: review.forcedSkip };
    const decision = decisions[row.rowNumber] ?? (review.needsDecision ? undefined : review.defaultDecision);
    if (decision === "skip") return { row, review, status: "skipped", decision: "skip", skipReason: "skipped_by_reviewer" };
    return { row, review, status: "pending", decision: decision ?? "import", skipReason: null };
  });
  const summary = {
    total: rows.length,
    toCreate: rows.filter((r) => r.status === "pending").length,
    invalid: rows.filter((r) => r.status === "invalid").length,
    skippedExact: rows.filter((r) => r.skipReason === "exact_duplicate" || r.skipReason === "duplicate_in_file").length,
    skippedByChoice: rows.filter((r) => r.skipReason === "skipped_by_reviewer").length,
    needsReview: rows.filter((r) => r.status === "pending" && r.row.lead.review_flags.length > 0).length,
    withWarnings: rows.filter((r) => r.review.warnings.length > 0).length,
    undecided: rows.filter((r) => r.status === "pending" && r.review.needsDecision && decisions[r.row.rowNumber] === undefined).length,
  };
  return { rows, summary, yearless: normalized.filter((r) => r.yearless).length };
}

export const SKIP_REASON_LABELS: Record<string, string> = {
  exact_duplicate: "Already imported (same source lead ID)",
  duplicate_in_file: "Repeated earlier in this file",
  skipped_by_reviewer: "Skipped during duplicate review",
  sync_possible_duplicate: "Possible duplicate event — skipped by Google Sheet sync",
  cancelled: "Import discarded",
};

/** Rows exactly as staged into import_rows (shared by the API route and tests). */
export function buildStagedRows(plan: PreparedImport) {
  return plan.rows.map((r) => {
    const base = { row_number: r.row.rowNumber, raw: r.row.original, issues: r.row.issues, warnings: r.review.warnings };
    if (r.status === "invalid") return { ...base, normalized: null, status: "invalid", decision: "skip", skip_reason: null };
    // Exact duplicates with a unique key go through the database's unique constraint, which skips
    // them and links the existing lead — the database stays the source of truth under concurrency.
    const dbEnforced =
      (r.skipReason === "exact_duplicate" || r.skipReason === "duplicate_in_file") &&
      Boolean(r.row.lead.external_lead_id || r.row.lead.source_fingerprint);
    if (r.status === "skipped" && !dbEnforced) {
      return { ...base, normalized: r.row.lead, status: "pending", decision: "skip", skip_reason: r.skipReason };
    }
    return { ...base, normalized: r.row.lead, status: "pending", decision: "import", skip_reason: null };
  });
}
