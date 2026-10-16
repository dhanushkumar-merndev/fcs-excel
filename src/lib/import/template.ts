import { isBlankCell, type RawRow } from "./cells";

/** The exact Meta lead export template, in order. */
export const TEMPLATE_COLUMNS = [
  { key: "id", header: "id", label: "Source lead ID", group: "source" },
  { key: "created_time", header: "created_time", label: "Lead created time", group: "source" },
  { key: "ad_id", header: "ad_id", label: "Ad ID", group: "ads" },
  { key: "ad_name", header: "ad_name", label: "Ad name", group: "ads" },
  { key: "adset_id", header: "adset_id", label: "Ad set ID", group: "ads" },
  { key: "adset_name", header: "adset_name", label: "Ad set name", group: "ads" },
  { key: "campaign_id", header: "campaign_id", label: "Campaign ID", group: "ads" },
  { key: "campaign_name", header: "campaign_name", label: "Campaign name", group: "ads" },
  { key: "form_id", header: "form_id", label: "Form ID", group: "ads" },
  { key: "form_name", header: "form_name", label: "Form name", group: "ads" },
  { key: "is_organic", header: "is_organic", label: "Organic", group: "ads" },
  { key: "platform", header: "platform", label: "Platform", group: "source" },
  { key: "occasion", header: "what's_the_occasion_for_your_event?", label: "Occasion", group: "event" },
  { key: "guests", header: "no_of_guests_", label: "Guest range", group: "event" },
  { key: "menu", header: "which_menu_needed?", label: "Menu", group: "event" },
  { key: "event_date", header: "event_date", label: "Event date", group: "event" },
  { key: "event_address", header: "event_address", label: "Event address", group: "event" },
  { key: "full_name", header: "full_name", label: "Customer name", group: "customer" },
  { key: "phone", header: "phone", label: "Phone", group: "customer" },
  { key: "lead_status", header: "lead_status", label: "Source status", group: "source" },
  { key: "crm_update", header: "CRM UPDATE", label: "Legacy CRM update", group: "source" },
] as const;

export type TemplateKey = (typeof TEMPLATE_COLUMNS)[number]["key"];
export const REQUIRED_KEYS: TemplateKey[] = ["full_name", "phone"];
export const MAX_IMPORT_ROWS = 1000;

/** Column → source header. null means "not in this file". */
export type ColumnMapping = Partial<Record<TemplateKey, string | null>>;

export function normalizeHeader(header: string) {
  return header
    .replace(/[  -​﻿]/g, " ")
    .replace(/[‘’ʼ]/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const ALIASES: Partial<Record<TemplateKey, string[]>> = {
  id: ["lead_id", "lead id", "leadgen_id"],
  created_time: ["created time", "created_at", "created at", "lead created"],
  full_name: ["name", "full name", "customer name", "customer_name"],
  phone: ["phone_number", "phone number", "mobile", "mobile number", "contact number", "whatsapp"],
  occasion: ["occasion", "what's the occasion for your event?", "whats_the_occasion_for_your_event?", "event_type", "event type"],
  guests: ["no_of_guests", "no of guests", "guests", "number of guests", "guest count", "no._of_guests"],
  menu: ["which_menu_needed", "which menu needed?", "menu", "menu type"],
  event_date: ["event date", "date of event"],
  event_address: ["event address", "address", "location", "venue"],
  lead_status: ["lead status", "status"],
  crm_update: ["crm_update", "crm update"],
  is_organic: ["is organic", "organic"],
};

/**
 * Maps file headers to template columns, tolerant of case, whitespace and trailing spaces.
 * Given the rows, the best-named column that actually has data wins: some exports carry both an
 * empty "event_date" and a filled "Event Date ".
 */
export function autoMapHeaders(headers: string[], rows: RawRow[] = []): ColumnMapping {
  const hasData = (header: string) => rows.some((r) => !isBlankCell(r.cells[header]));
  const used = new Set<string>();
  const mapping: ColumnMapping = {};
  for (const col of TEMPLATE_COLUMNS) {
    const names = [normalizeHeader(col.header), ...(ALIASES[col.key] ?? []).map(normalizeHeader)];
    const candidates = names.flatMap((name) => headers.filter((h) => !used.has(h) && normalizeHeader(h) === name));
    const hit = candidates.find(hasData) ?? candidates[0];
    mapping[col.key] = hit ?? null;
    if (hit) used.add(hit);
  }
  return mapping;
}

export function missingRequired(mapping: ColumnMapping) {
  return REQUIRED_KEYS.filter((k) => !mapping[k]);
}
