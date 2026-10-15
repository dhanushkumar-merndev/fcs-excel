/**
 * A spreadsheet cell as read from the file, before any cleaning.
 *  t: s = text, n = number, b = boolean, d = Excel date serial (date-formatted number), e = error, z = empty
 *  v: underlying value; w: text exactly as the spreadsheet displayed it (xlsx only).
 */
export type RawCell = { t: "s" | "n" | "b" | "d" | "e" | "z"; v: string | number | boolean | null; w?: string };

export type RawRow = { rowNumber: number; cells: Record<string, RawCell> };

export const EMPTY_CELL: RawCell = { t: "z", v: null };

/** Display text of a cell as the user saw it — what we preserve as the "original" value. */
export function cellText(cell: RawCell | undefined): string {
  if (!cell || cell.t === "z" || cell.v === null || cell.v === undefined) return "";
  if (cell.w !== undefined && cell.w !== "") return cell.w;
  return String(cell.v);
}

export function isBlankCell(cell: RawCell | undefined) {
  return cellText(cell).trim() === "";
}

/** Converts an Excel serial (1900 system) into calendar parts without timezone shifts. */
export function excelSerialToParts(serial: number) {
  // Excel's day 0 is 1899-12-30 once the fictitious 1900-02-29 is accounted for.
  const ms = Math.round((serial - 25569) * 86_400_000);
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

export const pad2 = (n: number) => String(n).padStart(2, "0");
