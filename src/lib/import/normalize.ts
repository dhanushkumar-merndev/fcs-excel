import { cellText, EMPTY_CELL, isBlankCell, type RawCell, type RawRow } from "./cells";
import { parseCreatedTime, parseEventDate, resolveYearless, type YearChoice } from "./dates";
import { normalizeId } from "./ids";
import { normalizePhone } from "./phone";
import { TEMPLATE_COLUMNS, type ColumnMapping, type TemplateKey } from "./template";

export type IssueSeverity = "error" | "warning" | "info";
export type Issue = { field: string; severity: IssueSeverity; code: string; message: string };

/** Cleaned values ready for the leads table (stored in import_rows.normalized). */
export type NormalizedLead = {
  customer_name: string;
  phone_e164: string | null;
  phone_raw: string | null;
  external_lead_id: string | null;
  external_lead_id_raw: string | null;
  external_id_damaged: boolean;
  source_fingerprint: string | null;
  source_created_at: string | null;
  ad_id: string | null;
  ad_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  form_id: string | null;
  form_name: string | null;
  is_organic: boolean | null;
  platform: string | null;
  occasion_code: string | null;
  menu_code: string | null;
  guest_range: string | null;
  event_date: string | null;
  event_date_raw: string | null;
  event_date_status: "confirmed" | "needs_review" | "missing";
  event_address: string | null;
  source_status: string | null;
  legacy_crm_update: string | null;
  review_flags: string[];
};

export type NormalizedRow = {
  /** Unique key for the row in this preview or import (the spreadsheet row for a single sheet). */
  rowNumber: number;
  /** Set when several sheets are previewed together: the sheet and its own row number. */
  sheet?: string;
  sourceRow?: number;
  /** Original values keyed by the file's own headers, as displayed. */
  original: Record<string, string>;
  lead: NormalizedLead;
  issues: Issue[];
  valid: boolean;
  /** Set when the event date had no year (resolved or not). */
  yearless?: { day: number; month: number; resolved: boolean };
};

/** Stored when a row has a phone but no name; flagged "Name missing" for review. */
export const NAME_PLACEHOLDER = "Name not given";

const EVENT_KEYS: TemplateKey[] = ["occasion", "guests", "menu", "event_date", "event_address"];

/** "row 27", or "CHEF ON DEMAND · row 27" when several sheets are previewed together. */
export function rowRef(row: Pick<NormalizedRow, "rowNumber" | "sheet" | "sourceRow">) {
  return row.sheet ? `${row.sheet.trim()} · row ${row.sourceRow ?? row.rowNumber}` : `row ${row.rowNumber}`;
}

const text = (cell: RawCell | undefined) => {
  const value = cellText(cell).replace(/\s+/g, " ").trim();
  return value === "" ? null : value;
};

/** house party / House_Party → house_party; keeps raw meaning while grouping consistently. */
export function toCode(cell: RawCell | undefined) {
  const value = text(cell);
  if (!value) return null;
  return value.toLowerCase().replace(/\s+/g, "_");
}

export function parseBoolean(cell: RawCell | undefined): { value: boolean | null; unreadable: boolean } {
  if (!cell || isBlankCell(cell)) return { value: null, unreadable: false };
  if (cell.t === "b") return { value: Boolean(cell.v), unreadable: false };
  const v = cellText(cell).trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(v)) return { value: true, unreadable: false };
  if (["false", "no", "n", "0"].includes(v)) return { value: false, unreadable: false };
  return { value: null, unreadable: true };
}

export function getCell(row: RawRow, mapping: ColumnMapping, key: TemplateKey): RawCell {
  const header = mapping[key];
  return (header && row.cells[header]) || EMPTY_CELL;
}

export function isRowEmpty(row: RawRow) {
  return Object.values(row.cells).every((c) => isBlankCell(c));
}

/**
 * Cleans one spreadsheet row. Pure and deterministic: the browser uses it for the preview and the
 * server re-runs it on the raw cells before saving, so the stored result never depends on the client.
 */
export function normalizeRow(row: RawRow, mapping: ColumnMapping, yearChoice: YearChoice): NormalizedRow {
  const issues: Issue[] = [];
  const flags = new Set<string>();
  const get = (key: TemplateKey) => getCell(row, mapping, key);

  const original: Record<string, string> = {};
  for (const [header, cell] of Object.entries(row.cells)) original[header] = cellText(cell);

  // Customer
  const name = text(get("full_name"));
  // A lead with a phone is still worth calling: a missing name never blocks the import.
  if (!name) {
    flags.add("name_missing");
    issues.push({ field: "full_name", severity: "warning", code: "name_missing", message: `Customer name is missing — imported as “${NAME_PLACEHOLDER}”.` });
  }

  const phone = normalizePhone(get("phone"));
  if (phone.status === "missing") {
    issues.push({ field: "phone", severity: "error", code: "phone_missing", message: "Phone number is missing." });
  } else if (phone.status === "invalid") {
    issues.push({ field: "phone", severity: "error", code: "phone_invalid", message: phone.message });
  } else if (phone.note) {
    issues.push({ field: "phone", severity: "info", code: "phone_country_assumed", message: phone.note });
  }

  // Source identifiers
  const leadId = normalizeId(get("id"));
  if (leadId.damaged) {
    flags.add("external_id_damaged");
    issues.push({ field: "id", severity: "warning", code: "id_damaged", message: leadId.message ?? "ID damaged." });
  }
  const idField = (key: TemplateKey) => {
    const result = normalizeId(get(key));
    if (result.damaged) {
      issues.push({ field: key, severity: "warning", code: "id_damaged", message: result.message ?? "ID damaged." });
    }
    return result.value ?? result.raw;
  };

  const created = parseCreatedTime(get("created_time"));
  if (created.error) {
    flags.add("created_time_unreadable");
    issues.push({
      field: "created_time",
      severity: "warning",
      code: "created_time_unreadable",
      message: `Couldn't read the lead creation time "${created.raw}". Reports will use the import time instead.`,
    });
  }

  const organic = parseBoolean(get("is_organic"));
  if (organic.unreadable) {
    flags.add("organic_flag_unreadable");
    issues.push({
      field: "is_organic",
      severity: "warning",
      code: "boolean_unreadable",
      message: `"${cellText(get("is_organic"))}" isn't true/false.`,
    });
  }

  // Event
  const parsedDate = parseEventDate(get("event_date"));
  let eventDate: string | null = null;
  let eventStatus: NormalizedLead["event_date_status"] = "missing";
  let yearless: NormalizedRow["yearless"];
  switch (parsedDate.kind) {
    case "date":
      eventDate = parsedDate.date;
      eventStatus = "confirmed";
      if (parsedDate.note) issues.push({ field: "event_date", severity: "info", code: "date_note", message: parsedDate.note });
      break;
    case "yearless": {
      const resolved = resolveYearless(parsedDate.day, parsedDate.month, yearChoice, created.iso);
      if (resolved && "date" in resolved) {
        eventDate = resolved.date;
        eventStatus = "confirmed";
        yearless = { day: parsedDate.day, month: parsedDate.month, resolved: true };
        issues.push({
          field: "event_date",
          severity: "info",
          code: "year_applied",
          message: `"${parsedDate.raw}" has no year — using ${resolved.date} from your year choice.`,
        });
      } else {
        eventStatus = "needs_review";
        flags.add("date_needs_review");
        yearless = { day: parsedDate.day, month: parsedDate.month, resolved: false };
        issues.push({
          field: "event_date",
          severity: "warning",
          code: "date_no_year",
          message:
            resolved && "error" in resolved
              ? `"${parsedDate.raw}": ${resolved.error} Imported without an event date.`
              : `"${parsedDate.raw}" has no year. Choose an event year, or import with "Date needs review".`,
        });
      }
      break;
    }
    case "ambiguous":
      eventStatus = "needs_review";
      flags.add("date_needs_review");
      issues.push({
        field: "event_date",
        severity: "warning",
        code: "date_ambiguous",
        message: `"${parsedDate.raw}" could be ${parsedDate.options[0]} or ${parsedDate.options[1]}. Imported without an event date — confirm with the customer.`,
      });
      break;
    case "invalid":
      eventStatus = "needs_review";
      flags.add("date_needs_review");
      issues.push({
        field: "event_date",
        severity: "warning",
        code: "date_invalid",
        message: `"${parsedDate.raw}": ${parsedDate.reason} Imported without an event date.`,
      });
      break;
  }

  const occasion = toCode(get("occasion"));
  const menu = toCode(get("menu"));
  const guests = text(get("guests"));
  const address = text(get("event_address"));
  const missing = [
    !parsedDate.raw && "event date",
    !occasion && "occasion",
    !guests && "guest range",
    !menu && "menu",
    !address && "address",
  ].filter(Boolean) as string[];
  // Only event-enquiry forms are expected to have event details; other forms (franchise,
  // webinar…) map none of these columns and aren't flagged for lacking them.
  const eventForm = EVENT_KEYS.some((k) => mapping[k]);
  if (eventForm && missing.length) {
    flags.add("event_details_missing");
    issues.push({
      field: "event",
      severity: "info",
      code: "event_details_missing",
      message: `Missing ${missing.join(", ")} — flagged for review.`,
    });
  }

  const sourceStatus = text(get("lead_status"));
  const createdRaw = created.raw || null;
  const fingerprint =
    !leadId.value && phone.status === "valid" && (leadId.raw || createdRaw)
      ? `meta|${leadId.raw ?? ""}|${phone.e164}|${createdRaw ?? ""}`
      : null;

  const lead: NormalizedLead = {
    customer_name: name ?? NAME_PLACEHOLDER,
    phone_e164: phone.status === "valid" ? phone.e164 : null,
    phone_raw: phone.raw || null,
    external_lead_id: leadId.value,
    external_lead_id_raw: leadId.raw,
    external_id_damaged: leadId.damaged,
    source_fingerprint: fingerprint,
    source_created_at: created.iso,
    ad_id: idField("ad_id"),
    ad_name: text(get("ad_name")),
    adset_id: idField("adset_id"),
    adset_name: text(get("adset_name")),
    campaign_id: idField("campaign_id"),
    campaign_name: text(get("campaign_name")),
    form_id: idField("form_id"),
    form_name: text(get("form_name")),
    is_organic: organic.value,
    platform: text(get("platform"))?.toLowerCase() ?? null,
    occasion_code: occasion,
    menu_code: menu,
    guest_range: guests,
    event_date: eventDate,
    event_date_raw: parsedDate.raw || null,
    event_date_status: eventStatus,
    event_address: address,
    source_status: sourceStatus,
    legacy_crm_update: text(get("crm_update")),
    review_flags: [...flags],
  };

  return {
    rowNumber: row.rowNumber,
    original,
    lead,
    issues,
    valid: !issues.some((i) => i.severity === "error"),
    yearless,
  };
}

export const TEMPLATE_HEADERS = TEMPLATE_COLUMNS.map((c) => c.header);
