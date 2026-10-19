import Papa from "papaparse";
import type * as XLSXNS from "xlsx";
import { isBlankCell, type RawCell, type RawRow } from "./cells";
import { MAX_IMPORT_ROWS } from "./template";

export type ParsedSheet = {
  name: string;
  headers: string[];
  /** Spreadsheet row number of the header row (1-based). */
  headerRow: number;
  rows: RawRow[];
};

export type ParsedFile = { kind: "xlsx" | "csv"; sheets: ParsedSheet[] };

export class ImportFileError extends Error {}

/** Unique, non-empty header names (duplicates get " (2)", blanks become "Column C"). */
function uniqueHeaders(raw: string[]) {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = (h ?? "").toString();
    if (!name.trim()) name = `Column ${columnLetter(i)}`;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count ? `${name} (${count + 1})` : name;
  });
}

export function columnLetter(index: number) {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function toSheet(name: string, grid: (RawCell | undefined)[][], rowNumbers: number[]): ParsedSheet {
  const headerIndex = grid.findIndex((row) => row.some((c) => !isBlankCell(c)));
  if (headerIndex < 0) return { name, headers: [], headerRow: 0, rows: [] };
  const headerCells = grid[headerIndex];
  const width = Math.max(headerCells.length, ...grid.slice(headerIndex + 1).map((r) => r.length));
  const headers = uniqueHeaders(Array.from({ length: width }, (_, i) => (headerCells[i] ? String(headerCells[i]!.w ?? headerCells[i]!.v ?? "") : "")));
  const rows: RawRow[] = [];
  for (let r = headerIndex + 1; r < grid.length; r++) {
    const line = grid[r];
    if (!line || !line.some((c) => !isBlankCell(c))) continue;
    const cells: Record<string, RawCell> = {};
    headers.forEach((h, i) => {
      cells[h] = line[i] ?? { t: "z", v: null };
    });
    rows.push({ rowNumber: rowNumbers[r], cells });
  }
  return { name, headers, headerRow: rowNumbers[headerIndex], rows };
}

export function parseCsv(text: string): ParsedFile {
  const clean = text.replace(/^﻿/, "");
  const result = Papa.parse<string[]>(clean, { skipEmptyLines: false, header: false });
  if (result.errors.some((e) => e.type === "Quotes")) {
    throw new ImportFileError("This CSV has unbalanced quotes. Re-export it from Excel or Google Sheets and try again.");
  }
  // Every CSV value stays text: long IDs and phone numbers are never converted to numbers.
  const grid = result.data.map((row) => row.map((v): RawCell => (v === "" ? { t: "z", v: null } : { t: "s", v })));
  return { kind: "csv", sheets: [toSheet("CSV", grid, grid.map((_, i) => i + 1))] };
}

function parseXlsx(XLSX: typeof XLSXNS, data: ArrayBuffer): ParsedFile {
  let wb: XLSXNS.WorkBook;
  try {
    wb = XLSX.read(data, { type: "array", cellDates: false, cellNF: true, cellText: true, dense: false });
  } catch {
    throw new ImportFileError("This file couldn't be read as an Excel workbook. Save it as .xlsx and try again.");
  }
  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) return { name, headers: [], headerRow: 0, rows: [] } satisfies ParsedSheet;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const grid: (RawCell | undefined)[][] = [];
    const rowNumbers: number[] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const line: (RawCell | undefined)[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSXNS.CellObject | undefined;
        if (!cell || cell.v === undefined || cell.v === null) {
          line.push(undefined);
          continue;
        }
        const w = cell.w;
        if (cell.t === "n") {
          const isDate = typeof cell.z === "string" && XLSX.SSF.is_date(cell.z);
          line.push({ t: isDate ? "d" : "n", v: cell.v as number, w });
        } else if (cell.t === "b") {
          line.push({ t: "b", v: Boolean(cell.v), w });
        } else if (cell.t === "e") {
          line.push({ t: "e", v: w ?? "#ERROR", w });
        } else {
          line.push({ t: "s", v: String(cell.v), w: w ?? String(cell.v) });
        }
      }
      grid.push(line);
      rowNumbers.push(r + 1);
    }
    return toSheet(name, grid, rowNumbers);
  });
  return { kind: "xlsx", sheets };
}

export function detectKind(fileName: string): "xlsx" | "csv" | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".csv")) return "csv";
  return null;
}

/** Parses an uploaded file. Works the same in the browser and on the server. */
export function parseImportFile(XLSX: typeof XLSXNS, fileName: string, data: ArrayBuffer): ParsedFile {
  const kind = detectKind(fileName);
  if (!kind) throw new ImportFileError("Upload an Excel (.xlsx) or CSV (.csv) file. Older .xls files must be saved as .xlsx first.");
  if (data.byteLength === 0) throw new ImportFileError("This file is empty.");
  if (kind === "csv") return parseCsv(new TextDecoder("utf-8").decode(data));
  return parseXlsx(XLSX, data);
}

export function rowLimitError(count: number) {
  return count > MAX_IMPORT_ROWS
    ? `This sheet has ${count.toLocaleString("en-IN")} data rows (blank rows ignored). The limit is ${MAX_IMPORT_ROWS.toLocaleString("en-IN")} per import — split it into ${Math.ceil(count / MAX_IMPORT_ROWS)} files and import each one. Re-importing rows that were already imported is safe: they're skipped.`
    : null;
}
