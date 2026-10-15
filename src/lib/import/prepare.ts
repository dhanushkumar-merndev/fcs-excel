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

export function normalizeAll(rows: RawRow[], mapping: ColumnMapping, yearChoice: YearChoice) {
  return rows.map((r) => normalizeRow(r, mapping, yearChoice));
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
  cancelled: "Import discarded",
};
