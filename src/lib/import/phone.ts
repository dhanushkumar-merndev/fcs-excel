import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { cellText, type RawCell } from "./cells";

export type PhoneResult =
  | { status: "valid"; e164: string; raw: string; country: string | undefined }
  | { status: "missing"; raw: string }
  | { status: "invalid"; raw: string; message: string };

/**
 * Normalizes a phone value to E.164. Accepts Meta's `p:+919991999189`, local Indian numbers
 * (10 digits, 0-prefixed, or 91-prefixed without +), and international numbers with +/00.
 * Never guesses: anything not clearly valid is reported as invalid with the reason.
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
  if (/[^\d+]/.test(text) || text.lastIndexOf("+") > 0) {
    return { status: "invalid", raw, message: "Contains characters that aren't part of a phone number." };
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
  if (!parsed) {
    return { status: "invalid", raw, message: "Not a recognizable phone number." };
  }
  if (parsed.isValid()) {
    return { status: "valid", e164: parsed.number, raw, country: parsed.country };
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
