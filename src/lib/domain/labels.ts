/** Display labels for source codes. Raw codes are always stored; labels are computed. */

const PLATFORM_LABELS: Record<string, string> = {
  ig: "Instagram",
  instagram: "Instagram",
  fb: "Facebook",
  facebook: "Facebook",
  msg: "Messenger",
  an: "Audience Network",
  wa: "WhatsApp",
  whatsapp: "WhatsApp",
  phone: "Phone call",
  referral: "Referral",
  walk_in: "Walk-in",
  website: "Website",
  other: "Other",
};

const CODE_OVERRIDES: Record<string, string> = {
  veg_menu: "Veg Menu",
  non_veg_menu: "Non-Veg Menu",
  nonveg_menu: "Non-Veg Menu",
  "non-veg_menu": "Non-Veg Menu",
  house_party: "House Party",
  bday: "Birthday",
};

const SMALL_WORDS = new Set(["and", "or", "of", "the", "a", "an", "to", "in", "for", "on", "with"]);

export function platformLabel(code: string | null | undefined) {
  if (!code) return "—";
  return PLATFORM_LABELS[code.trim().toLowerCase()] ?? humanizeCode(code);
}

/** house_party → House Party, veg_menu → Veg Menu. */
export function humanizeCode(code: string | null | undefined) {
  if (!code) return "—";
  const key = code.trim().toLowerCase();
  if (CODE_OVERRIDES[key]) return CODE_OVERRIDES[key];
  const words = key.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().split(" ");
  return words
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export const occasionLabel = humanizeCode;
export const menuLabel = humanizeCode;

/**
 * Guest ranges are preserved as ranges: 1_-_10 → 1–10, more_than_30 → More than 30.
 * Never converted to an exact headcount.
 */
export function guestRangeLabel(raw: string | null | undefined) {
  if (!raw) return "—";
  const value = raw.trim();
  const range = value.match(/^(\d+)\s*_*\s*[-–to]+\s*_*\s*(\d+)$/i);
  if (range) return `${range[1]}–${range[2]}`;
  const more = value.match(/^(more|greater)[_\s]+than[_\s]+(\d+)$/i);
  if (more) return `More than ${more[2]}`;
  const plus = value.match(/^(\d+)\s*\+$/);
  if (plus) return `${plus[1]}+`;
  const less = value.match(/^(less|fewer)[_\s]+than[_\s]+(\d+)$/i);
  if (less) return `Less than ${less[2]}`;
  return humanizeCode(value);
}

export const CALL_OUTCOMES = [
  { value: "connected", label: "Connected" },
  { value: "no_answer", label: "No answer" },
  { value: "busy", label: "Busy" },
  { value: "switched_off", label: "Switched off" },
  { value: "wrong_number", label: "Wrong number" },
  { value: "callback_requested", label: "Customer requested callback" },
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number]["value"];

export function callOutcomeLabel(value: string | null | undefined) {
  return CALL_OUTCOMES.find((o) => o.value === value)?.label ?? humanizeCode(value);
}

export const MANUAL_CHANNELS = [
  { value: "phone", label: "Phone call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "referral", label: "Referral" },
  { value: "walk_in", label: "Walk-in" },
  { value: "website", label: "Website" },
  { value: "other", label: "Other" },
] as const;

export const REVIEW_FLAG_LABELS: Record<string, string> = {
  date_needs_review: "Date needs review",
  event_details_missing: "Event details missing",
  external_id_damaged: "Source ID damaged",
  organic_flag_unreadable: "Organic flag unreadable",
  created_time_unreadable: "Created time unreadable",
  name_missing: "Name missing",
};

export function reviewFlagLabel(flag: string) {
  return REVIEW_FLAG_LABELS[flag] ?? humanizeCode(flag);
}

export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  salesperson: "Salesperson",
};

/**
 * How an import is named: the worksheet when it's meaningful ("CHEF ON DEMAND"), with the file as
 * context; just the file for CSVs and default sheet names. Mirrors private.import_label in SQL.
 */
export function importName(fileName: string, sheetName?: string | null): { title: string; file: string | null } {
  const sheet = sheetName?.trim();
  return sheet && !/^(csv|sheet ?\d*)$/i.test(sheet) ? { title: sheet, file: fileName } : { title: fileName, file: null };
}
