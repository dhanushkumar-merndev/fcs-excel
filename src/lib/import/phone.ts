import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { cellText, type RawCell } from "./cells";

export type PhoneResult =
  | { status: "valid"; e164: string; raw: string; country: string | undefined; note?: string }
  | { status: "missing"; raw: string }
  | { status: "invalid"; raw: string; message: string };

/**
 * Normalizes a phone value to E.164. Accepts Meta's `p:+919991999189`, local Indian numbers
 * (10 digits, 0-prefixed, or 91-prefixed without +), and international numbers with +/00.
 * Corrections it makes — dropping stray text around a full number, and reading a "+" plus 10-digit
 * Indian mobile as +91 — are noted on the row; anything else that isn't clearly valid is reported as
 * invalid with the reason.
 */
export function normalizePhone(input: RawCell | string | null | undefined, defaultCountry: CountryCode = "IN"): PhoneResult {
  const cell: RawCell | undefined = typeof input === "string" ? { t: "s", v: input } : (input ?? undefined);
  const raw = cellText(cell).trim();
  if (!raw) return { status: "missing", raw };

  let stored: string | null = null;
  if (cell?.t === "n" && typeof cell.v === "number") {
    // Excel keeps whole numbers of up to 15 digits exactly, even when it displays them as
    // 9.19886E+11, so the stored value is used. Fractional or longer numbers have lost digits.
    if (!Number.isSafeInteger(cell.v) || Math.abs(cell.v).toString().length > 15) {
      return {
        status: "invalid",
        raw,
        message: "Excel stored this phone number as a rounded number, so digits are missing. Format the column as Text and re-export.",
      };
    }
    stored = Math.abs(cell.v).toString();
  } else if (/^\d(\.\d+)?e\+?\d+$/i.test(raw)) {
    // Text such as "9.19886E+11" (e.g. a CSV saved from Excel) has really lost the digits.
    return {
      status: "invalid",
      raw,
      message: "This phone number was saved in scientific notation, so digits are missing. Format the column as Text in Excel and re-export.",
    };
  }

  let text = (stored ?? raw)
    .replace(/^(p|tel|phone)\s*:\s*/i, "")
    .replace(/[\s \-().\/]/g, "");
  if (text.startsWith("00")) text = `+${text.slice(2)}`;
  let note: string | undefined;
  if (/[^\d+]/.test(text) || text.lastIndexOf("+") > 0) {
    // Stray text around the number ("+9198… in", "l98…"): keep only the digits when a full number remains.
    const digits = text.replace(/\D/g, "");
    if (digits.length < 10) {
      return { status: "invalid", raw, message: "Contains characters that aren't part of a phone number." };
    }
    text = `${text.startsWith("+") ? "+" : ""}${digits}`;
    note = `"${raw}" had extra characters — only its digits were used.`;
  }

  if (!text.startsWith("+")) {
    const digits = text;
    if (defaultCountry === "IN") {
      if (/^[6-9]\d{9}$/.test(digits)) text = `+91${digits}`;
      else if (/^0[6-9]\d{9}$/.test(digits)) text = `+91${digits.slice(1)}`;
      else if (/^91[6-9]\d{9}$/.test(digits)) text = `+${digits}`;
    }
  }

  const parsed = text.startsWith("+")
    ? parsePhoneNumberFromString(text)
    : parsePhoneNumberFromString(text, defaultCountry);
  if (parsed?.isValid()) {
    return { status: "valid", e164: parsed.number, raw, country: parsed.country, ...(note ? { note } : {}) };
  }

  // Lead forms often get a "+" typed straight before a 10-digit Indian mobile (p:+8527607478 reads
  // as Hong Kong, p:+9819115971 as Iran). When the number isn't valid as written and its last 10
  // digits are an Indian mobile with at most a 0 / 91 / 0091 prefix, it is read as +91 — with a note.
  if (defaultCountry === "IN") {
    const mobile = text.replace(/\D/g, "").match(/^(?:0|91|910|091|0091)?([6-9]\d{9})$/)?.[1];
    const india = mobile ? parsePhoneNumberFromString(`+91${mobile}`) : undefined;
    if (india?.isValid()) {
      return {
        status: "valid",
        e164: india.number,
        raw,
        country: "IN",
        note: `"${raw}" isn't a valid number as written — read the last 10 digits as an Indian mobile.`,
      };
    }
  }

  if (!parsed) {
    return { status: "invalid", raw, message: note ? "Contains characters that aren't part of a phone number." : "Not a recognizable phone number." };
  }
  const digitCount = text.replace(/\D/g, "").length;
  if (parsed.isPossible()) {
    return {
      status: "invalid",
      raw,
      message: "Ambiguous number: it has a plausible length but isn't a valid number for its country. Check it with the customer.",
    };
  }
  return {
    status: "invalid",
    raw,
    message: digitCount < 10 ? "Too few digits for a phone number." : "Too many digits for a phone number.",
  };
}
