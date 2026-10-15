import { cellText, type RawCell } from "./cells";

export type IdResult = {
  /** Exact identifier usable for matching, or null when missing/damaged. */
  value: string | null;
  /** Text as it appeared in the file. */
  raw: string | null;
  damaged: boolean;
  message?: string;
};

const SCIENTIFIC = /^-?\d+(\.\d+)?e[+-]?\d+$/i;

/**
 * Keeps identifiers as text, preserving prefixes like l:, ag:, as:, c:, f:.
 * Excel stores numbers with 15 significant digits: a numeric cell with 16+ digits, or one shown
 * in scientific notation, has already lost digits. Such IDs are flagged and never "repaired".
 */
export function normalizeId(cell: RawCell | undefined): IdResult {
  const text = cellText(cell).trim();
  if (!text) return { value: null, raw: null, damaged: false };

  if (cell?.t === "n" && typeof cell.v === "number") {
    const n = cell.v;
    const digits = Number.isFinite(n) ? Math.abs(Math.trunc(n)).toString().replace(/e.*$/i, "").length : 0;
    const exactInteger = Number.isInteger(n) && Number.isSafeInteger(n);
    if (!exactInteger || digits >= 16 || SCIENTIFIC.test(text)) {
      if (exactInteger && digits < 16) {
        // Displayed in scientific form but the stored value is still exact.
        return { value: n.toFixed(0), raw: text, damaged: false };
      }
      return {
        value: null,
        raw: text,
        damaged: true,
        message: `This ID (${text}) was stored as a number by Excel and may have lost digits. It is kept as-is and not used for duplicate matching.`,
      };
    }
    return { value: n.toFixed(0), raw: text, damaged: false };
  }

  if (SCIENTIFIC.test(text)) {
    return {
      value: null,
      raw: text,
      damaged: true,
      message: `This ID (${text}) is in scientific notation, so digits are missing. It is kept as-is and not used for duplicate matching.`,
    };
  }
  // Unprefixed 16+ digit IDs whose digits after the 15th are all zeros were almost certainly
  // rounded by Excel before the file was saved (e.g. a CSV exported from Excel).
  if (/^\d{16,}$/.test(text) && /^0+$/.test(text.slice(15))) {
    return {
      value: null,
      raw: text,
      damaged: true,
      message: `This ID (${text}) ends in zeros after the 15th digit, which is how Excel rounds long numbers. It is kept as-is and not used for duplicate matching.`,
    };
  }
  return { value: text, raw: text, damaged: false };
}
