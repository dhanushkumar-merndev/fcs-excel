import type { NormalizedRow } from "./normalize";

/** An existing lead returned by import_find_matches. */
export type ExistingLead = {
  lead_id: string;
  lead_number: number;
  customer_name: string;
  phone_e164: string;
  source_system: string;
  external_lead_id: string | null;
  external_lead_id_raw: string | null;
  event_date: string | null;
  event_date_status: string;
  occasion_code: string | null;
  menu_code: string | null;
  guest_range: string | null;
  event_address: string | null;
  stage: string;
  owner_id: string | null;
  owner_name: string | null;
};

export type DuplicateKind = "exact_duplicate" | "duplicate_in_file" | "possible_duplicate_event" | "repeat_customer";

export type DuplicateWarning = {
  kind: DuplicateKind;
  reason: string;
  /** Existing lead in the database */
  lead?: {
    id: string;
    number: number;
    name: string;
    eventDate: string | null;
    stage: string;
    ownerName: string | null;
  };
  /** Earlier row in this file */
  row?: { rowNumber: number; name: string; eventDate: string | null };
};

export type DuplicateReview = {
  warnings: DuplicateWarning[];
  /** Exact duplicates are always skipped and link to the existing record. */
  forcedSkip: null | "exact_duplicate" | "duplicate_in_file";
  /** Possible duplicate events need an explicit Keep/Skip decision. */
  needsDecision: boolean;
  defaultDecision: "import" | "skip";
};

function tokens(value: string | null) {
  return new Set(
    (value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

export function addressSimilarity(a: string | null, b: string | null) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

type EventShape = { event_date: string | null; occasion_code: string | null; event_address: string | null };

/** Same confirmed date plus similar details (same occasion, similar address, or details missing on either side). */
export function isSameEvent(a: EventShape & { confirmed: boolean }, b: EventShape & { confirmed: boolean }) {
  if (!a.confirmed || !b.confirmed || !a.event_date || a.event_date !== b.event_date) return false;
  if (a.occasion_code && b.occasion_code) {
    if (a.occasion_code === b.occasion_code) return true;
  }
  if (a.event_address && b.event_address) return addressSimilarity(a.event_address, b.event_address) >= 0.5;
  return !(a.occasion_code && b.occasion_code);
}

/**
 * Classifies duplicates against existing leads and earlier rows of the same file.
 * Only valid normalized phones are ever compared; blank or invalid phones never match.
 */
export function reviewDuplicates(rows: NormalizedRow[], existing: ExistingLead[]): Map<number, DuplicateReview> {
  const byExternalId = new Map<string, ExistingLead>();
  const byRawIdPhone = new Map<string, ExistingLead>();
  const byPhone = new Map<string, ExistingLead[]>();
  for (const lead of existing) {
    if (lead.source_system === "meta_lead_ads" && lead.external_lead_id) byExternalId.set(lead.external_lead_id, lead);
    if (lead.external_lead_id_raw) byRawIdPhone.set(`${lead.external_lead_id_raw}|${lead.phone_e164}`, lead);
    const list = byPhone.get(lead.phone_e164) ?? [];
    list.push(lead);
    byPhone.set(lead.phone_e164, list);
  }

  const seenIds = new Map<string, NormalizedRow>();
  const seenPhones = new Map<string, NormalizedRow[]>();
  const result = new Map<number, DuplicateReview>();

  for (const row of rows) {
    const review: DuplicateReview = { warnings: [], forcedSkip: null, needsDecision: false, defaultDecision: "import" };
    result.set(row.rowNumber, review);
    if (!row.valid || !row.lead.phone_e164) continue;
    const { lead } = row;
    const phone = lead.phone_e164!;

    const exact =
      (lead.external_lead_id && byExternalId.get(lead.external_lead_id)) ||
      (!lead.external_lead_id && lead.external_lead_id_raw && byRawIdPhone.get(`${lead.external_lead_id_raw}|${phone}`)) ||
      null;
    if (exact) {
      review.forcedSkip = "exact_duplicate";
      review.defaultDecision = "skip";
      review.warnings.push({
        kind: "exact_duplicate",
        reason: lead.external_lead_id
          ? `Source lead ID ${lead.external_lead_id} was already imported.`
          : `Same source ID text and phone as an existing lead.`,
        lead: summarize(exact),
      });
      continue;
    }

    const idKey = lead.external_lead_id ?? (lead.source_fingerprint ? `fp:${lead.source_fingerprint}` : null);
    const earlierSame = idKey ? seenIds.get(idKey) : undefined;
    if (earlierSame) {
      review.forcedSkip = "duplicate_in_file";
      review.defaultDecision = "skip";
      review.warnings.push({
        kind: "duplicate_in_file",
        reason: `Repeats row ${earlierSame.rowNumber} of this file (same source lead).`,
        row: { rowNumber: earlierSame.rowNumber, name: earlierSame.lead.customer_name, eventDate: earlierSame.lead.event_date },
      });
      continue;
    }
    if (idKey) seenIds.set(idKey, row);

    const me = { ...lead, confirmed: lead.event_date_status === "confirmed" };
    for (const other of byPhone.get(phone) ?? []) {
      const same = isSameEvent(me, { ...other, confirmed: other.event_date_status === "confirmed" });
      review.warnings.push({
        kind: same ? "possible_duplicate_event" : "repeat_customer",
        reason: same
          ? `Same phone and the same event date (${other.event_date})${other.occasion_code && other.occasion_code === lead.occasion_code ? " and occasion" : ""}.`
          : "Same phone number as an existing enquiry.",
        lead: summarize(other),
      });
    }
    for (const other of seenPhones.get(phone) ?? []) {
      const same = isSameEvent(me, { ...other.lead, confirmed: other.lead.event_date_status === "confirmed" });
      review.warnings.push({
        kind: same ? "possible_duplicate_event" : "repeat_customer",
        reason: same
          ? `Same phone and event date as row ${other.rowNumber} of this file.`
          : `Same phone number as row ${other.rowNumber} of this file.`,
        row: { rowNumber: other.rowNumber, name: other.lead.customer_name, eventDate: other.lead.event_date },
      });
    }
    seenPhones.set(phone, [...(seenPhones.get(phone) ?? []), row]);

    review.needsDecision = review.warnings.some((w) => w.kind === "possible_duplicate_event");
  }
  return result;
}

function summarize(lead: ExistingLead): NonNullable<DuplicateWarning["lead"]> {
  return {
    id: lead.lead_id,
    number: lead.lead_number,
    name: lead.customer_name,
    eventDate: lead.event_date,
    stage: lead.stage,
    ownerName: lead.owner_name,
  };
}
