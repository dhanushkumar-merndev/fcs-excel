import { cellText, excelSerialToParts, pad2, type RawCell } from "./cells";

export type EventDateResult =
  | { kind: "empty"; raw: "" }
  | { kind: "date"; date: string; raw: string; note?: string }
  | { kind: "yearless"; day: number; month: number; raw: string }
  | { kind: "ambiguous"; raw: string; options: [string, string] }
  | { kind: "invalid"; raw: string; reason: string };

export type YearChoice = { mode: "unresolved" } | { mode: "fixed"; year: number } | { mode: "after_created" };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function editDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** Month number for a name or abbreviation, tolerating small typos ("septmber", "desember"). */
export function monthOf(word: string): number | undefined {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (MONTHS[w]) return MONTHS[w];
  if (w.length < 5) return undefined;
  const limit = w.length >= 7 ? 2 : 1;
  const hits = FULL_MONTHS.flatMap((name, i) => (name[0] === w[0] && editDistance(w, name) <= limit ? [i + 1] : []));
  return hits.length === 1 ? hits[0] : undefined;
}

/** Tidies common typing quirks: "11 th" → "11th", "17 /10/26" → "17/10/26", "7septmber" → "7 septmber". */
function tidy(raw: string) {
  return raw
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/(^|[^a-z])0ct\b/g, "$1oct")
    .replace(/\s+/g, " ")
    .replace(/(\d)\s+(st|nd|rd|th)\b/g, "$1$2")
    .replace(/(\d)\s*([\/.\-])\s*(?=\d)/g, "$1$2")
    .replace(/(\d)(?!(?:st|nd|rd|th)\b)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .trim();
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Max days a month can ever have (Feb = 29). */
function maxDays(month: number) {
  return month === 2 ? 29 : daysInMonth(2001, month);
}

function iso(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function validDate(year: number, month: number, day: number) {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function expandYear(y: string) {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

export function describeDayMonth(day: number, month: number) {
  return `${day} ${MONTH_NAMES[month - 1]}`;
}

/**
 * Reads an event date without guessing. Real Excel dates and complete date strings become
 * calendar dates; "29 October"-style values are returned as yearless for explicit resolution;
 * DD/MM vs MM/DD ambiguity and impossible dates are reported, never silently resolved.
 */
export function parseEventDate(cell: RawCell | undefined): EventDateResult {
  const raw = cellText(cell).trim();
  if (!raw) return { kind: "empty", raw: "" };

  if (cell && (cell.t === "d" || cell.t === "n") && typeof cell.v === "number") {
    const serial = cell.v;
    if (cell.t === "d" || (serial >= 36526 && serial <= 73051)) {
      const p = excelSerialToParts(serial);
      return {
        kind: "date",
        date: iso(p.year, p.month, p.day),
        raw,
        note: cell.t === "n" ? "Read as an Excel date number." : undefined,
      };
    }
    return { kind: "invalid", raw, reason: "A plain number isn't a date." };
  }

  const text = tidy(raw);

  // ISO: 2026-10-29 (optionally with time)
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t].*)?$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validDate(y, mo, d)
      ? { kind: "date", date: iso(y, mo, d), raw }
      : { kind: "invalid", raw, reason: "This date doesn't exist on the calendar." };
  }

  // Numeric: 29/10/2026, 29-10-26, 05.10.2025
  m = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = expandYear(m[3]);
    const dmy = validDate(y, b, a) ? iso(y, b, a) : null;
    const mdy = validDate(y, a, b) ? iso(y, a, b) : null;
    if (dmy && mdy && dmy !== mdy) return { kind: "ambiguous", raw, options: [dmy, mdy] };
    if (dmy) return { kind: "date", date: dmy, raw };
    if (mdy) return { kind: "date", date: mdy, raw, note: "Read as month/day/year." };
    return { kind: "invalid", raw, reason: "This date doesn't exist on the calendar." };
  }

  // Day and month without a year: 22/9, 22-09 (day first, as written in India).
  m = text.match(/^(\d{1,2})[\/.\-](\d{1,2})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a <= 12 && b <= 12 && a !== b) return { kind: "invalid", raw, reason: "Could be day/month or month/day, and has no year." };
    const [day, month] = b <= 12 ? [a, b] : [b, a];
    if (month < 1 || month > 12 || day < 1 || day > maxDays(month)) return { kind: "invalid", raw, reason: "This date doesn't exist on the calendar." };
    return { kind: "yearless", day, month, raw };
  }

  // Day-first with month name: 29 October, 25 nov, 31st oct 2026, 29-Oct-2026
  m = text.match(/^(\d{1,2})(?:st|nd|rd|th)?[ \-\/.]*([a-z]+)\.?(?:[ \-\/.]+(\d{2}|\d{4}))?$/);
  if (!m) {
    // Month-first: October 29, Oct 29 2026
    const alt = text.match(/^([a-z]+)\.?[ \-\/.]*(\d{1,2})(?:st|nd|rd|th)?(?:[ \-\/.]+(\d{2}|\d{4}))?$/);
    if (alt) m = [alt[0], alt[2], alt[1], alt[3]] as unknown as RegExpMatchArray;
  }
  if (m) {
    const day = Number(m[1]);
    const month = monthOf(m[2]);
    if (!month) return { kind: "invalid", raw, reason: `"${m[2]}" isn't a month name.` };
    if (day < 1 || day > maxDays(month)) {
      return { kind: "invalid", raw, reason: `${day} ${MONTH_NAMES[month - 1]} doesn't exist.` };
    }
    if (m[3]) {
      const y = expandYear(m[3]);
      return validDate(y, month, day)
        ? { kind: "date", date: iso(y, month, day), raw }
        : { kind: "invalid", raw, reason: `${describeDayMonth(day, month)} ${y} doesn't exist.` };
    }
    return { kind: "yearless", day, month, raw };
  }

  return findDateInText(text, raw) ?? { kind: "invalid", raw, reason: "Couldn't read this as a date." };
}

const DAY = "(\\d{1,2})(?:st|nd|rd|th)?";
const MORE_DAYS = "(?:\\s*(?:-|to|&|and|or|\\/)\\s*\\d{1,2}(?:st|nd|rd|th)?)*";
const YEAR = "(?:\\s+(\\d{4}|\\d{2})\\b)?";
const IN_TEXT_NUMERIC = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})\b/;
const IN_TEXT_DAY_MONTH = new RegExp(`\\b${DAY}${MORE_DAYS}\\s*(?:of\\s+)?([a-z]{3,})\\b\\.?${YEAR}`);
const IN_TEXT_MONTH_DAY = new RegExp(`\\b([a-z]{3,})\\.?\\s*${DAY}\\b${YEAR}`);

/**
 * A date written inside other text: "6th nov - approximately 30 people", "17 to 20 oct",
 * "october 10 dinner", "jain food … 23/24 september". The first clear date is used and a note says
 * so; the full original text stays on the lead.
 */
function findDateInText(text: string, raw: string): EventDateResult | null {
  const note = `Read the date written in “${raw.replace(/\s+/g, " ").trim()}”.`;
  const numeric = text.match(IN_TEXT_NUMERIC);
  if (numeric) {
    const inner = parseEventDate({ t: "s", v: `${numeric[1]}/${numeric[2]}/${numeric[3]}` });
    if (inner.kind === "date") return { ...inner, raw, note };
    if (inner.kind === "ambiguous") return { ...inner, raw };
  }
  for (const [pattern, dayIndex, monthIndex] of [
    [IN_TEXT_DAY_MONTH, 1, 2],
    [IN_TEXT_MONTH_DAY, 2, 1],
  ] as const) {
    const m = text.match(pattern);
    const month = m ? monthOf(m[monthIndex]) : undefined;
    if (!m || !month) continue;
    const day = Number(m[dayIndex]);
    if (day < 1 || day > maxDays(month)) continue;
    if (m[3]) {
      const y = expandYear(m[3]);
      if (validDate(y, month, day)) return { kind: "date", date: iso(y, month, day), raw, note };
      continue;
    }
    return { kind: "yearless", day, month, raw };
  }
  return null;
}

/**
 * DD/MM vs MM/DD: an enquiry is for an upcoming event, so when exactly one reading falls between
 * the lead's creation day and a year after it, that reading is used. Otherwise it stays ambiguous.
 */
export function resolveAmbiguous(options: [string, string], createdAt: string | null): string | null {
  if (!createdAt) return null;
  const created = new Date(new Date(createdAt).getTime() + 330 * 60_000);
  const from = created.toISOString().slice(0, 10);
  const to = new Date(created.getTime() + 366 * 86_400_000).toISOString().slice(0, 10);
  const plausible = options.filter((d) => d >= from && d <= to);
  return plausible.length === 1 ? plausible[0] : null;
}

/** Applies an explicit year choice to a yearless date. Returns null when unresolved or impossible. */
export function resolveYearless(
  day: number,
  month: number,
  choice: YearChoice,
  createdAt: string | null,
): { date: string } | { error: string } | null {
  if (choice.mode === "unresolved") return null;
  let year: number;
  if (choice.mode === "fixed") {
    year = choice.year;
  } else {
    if (!createdAt) return { error: "No lead creation date to compare with." };
    const created = new Date(createdAt);
    // Compare in IST calendar terms.
    const ist = new Date(created.getTime() + 330 * 60_000);
    const cy = ist.getUTCFullYear();
    const createdIso = iso(cy, ist.getUTCMonth() + 1, ist.getUTCDate());
    year = cy;
    if (!validDate(year, month, day) || iso(year, month, day) < createdIso) year = cy + 1;
  }
  if (!validDate(year, month, day)) return { error: `${describeDayMonth(day, month)} ${year} doesn't exist.` };
  return { date: iso(year, month, day) };
}

export type InstantResult = { iso: string | null; raw: string; error?: string };

/**
 * Reads an original lead creation timestamp. Explicit offsets are honoured; values without an
 * offset (and Excel date cells) are interpreted as IST wall-clock time.
 */
export function parseCreatedTime(cell: RawCell | undefined): InstantResult {
  const raw = cellText(cell).trim();
  if (!raw) return { iso: null, raw };

  const fromIstParts = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => {
    if (!validDate(y, mo, d) || h > 23 || mi > 59 || s > 59) return null;
    return new Date(Date.UTC(y, mo - 1, d, h, mi, s) - 330 * 60_000).toISOString();
  };

  if (cell && (cell.t === "d" || cell.t === "n") && typeof cell.v === "number" && cell.v > 20000 && cell.v < 80000) {
    const p = excelSerialToParts(cell.v);
    return { iso: fromIstParts(p.year, p.month, p.day, p.hour, p.minute, p.second), raw };
  }

  const m = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i,
  );
  if (m) {
    const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
    if (m[7]) {
      const offset = m[7].toUpperCase() === "Z" ? "Z" : m[7].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
      const date = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${pad2(s)}${offset}`);
      return Number.isNaN(date.getTime()) ? { iso: null, raw, error: "Unreadable timestamp." } : { iso: date.toISOString(), raw };
    }
    const value = fromIstParts(y, mo, d, h, mi, s);
    return value ? { iso: value, raw } : { iso: null, raw, error: "Unreadable timestamp." };
  }
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const value = fromIstParts(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
    return value ? { iso: value, raw } : { iso: null, raw, error: "Unreadable timestamp." };
  }
  const dmy = raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i);
  if (dmy) {
    const a = Number(dmy[1]);
    const b = Number(dmy[2]);
    if (a <= 12 && b <= 12 && a !== b) return { iso: null, raw, error: "Day and month are ambiguous." };
    const [day, month] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b];
    let hour = Number(dmy[4] ?? 0);
    if (dmy[7]) hour = (hour % 12) + (dmy[7].toLowerCase() === "pm" ? 12 : 0);
    const value = fromIstParts(Number(dmy[3]), month, day, hour, Number(dmy[5] ?? 0), Number(dmy[6] ?? 0));
    return value ? { iso: value, raw } : { iso: null, raw, error: "Unreadable timestamp." };
  }
  return { iso: null, raw, error: "Unreadable timestamp." };
}
