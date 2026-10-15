import "server-only";
import * as XLSX from "xlsx";

export type ColumnType = "text" | "number" | "date" | "datetime" | "bool";
export type Column = { header: string; type: ColumnType; width?: number };
export type SheetSpec = { name: string; columns: Column[]; rows: unknown[][] };

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Neutralizes formula injection. CSV gets the full OWASP set; xlsx text cells can't run formulas but = and @ are still escaped. */
export function sanitize(value: string, target: "csv" | "xlsx") {
  const risky = target === "csv" ? /^[=+\-@\t\r]/ : /^[=@\t\r]/;
  return risky.test(value) ? `'${value}` : value;
}

function dateSerial(value: string) {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS + 25569;
}

function datetimeSerial(value: string) {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : (ms + IST_MS) / DAY_MS + 25569;
}

function toCell(value: unknown, type: ColumnType): XLSX.CellObject | null {
  if (value === null || value === undefined || value === "") return null;
  switch (type) {
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) ? { t: "n", v: n } : { t: "s", v: sanitize(String(value), "xlsx") };
    }
    case "date": {
      const serial = dateSerial(String(value));
      return serial === null ? { t: "s", v: sanitize(String(value), "xlsx") } : { t: "n", v: serial, z: "dd mmm yyyy" };
    }
    case "datetime": {
      const serial = datetimeSerial(String(value));
      return serial === null ? { t: "s", v: sanitize(String(value), "xlsx") } : { t: "n", v: serial, z: "dd mmm yyyy hh:mm" };
    }
    case "bool":
      return { t: "s", v: value === true || value === "true" ? "TRUE" : "FALSE" };
    default:
      // Phones and IDs stay text: never converted to numbers.
      return { t: "s", v: sanitize(String(value), "xlsx") };
  }
}

export function buildWorkbook(sheets: SheetSpec[]) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws: XLSX.WorkSheet = {};
    sheet.columns.forEach((c, ci) => {
      ws[XLSX.utils.encode_cell({ r: 0, c: ci })] = { t: "s", v: c.header };
    });
    sheet.rows.forEach((row, ri) => {
      sheet.columns.forEach((c, ci) => {
        const cell = toCell(row[ci], c.type);
        if (cell) ws[XLSX.utils.encode_cell({ r: ri + 1, c: ci })] = cell;
      });
    });
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(sheet.rows.length, 1), c: Math.max(sheet.columns.length - 1, 0) } });
    ws["!cols"] = sheet.columns.map((c) => ({ wch: c.width ?? Math.min(40, Math.max(10, c.header.length + 2)) }));
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(sheet.columns.length - 1, 0) } }) };
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}

function csvValue(value: unknown, type: ColumnType) {
  if (value === null || value === undefined) return "";
  let text: string;
  if (type === "datetime") {
    const ms = Date.parse(String(value));
    text = Number.isNaN(ms) ? String(value) : new Date(ms + IST_MS).toISOString().slice(0, 16).replace("T", " ");
  } else if (type === "bool") {
    text = value === true || value === "true" ? "TRUE" : "FALSE";
  } else {
    text = String(value);
  }
  text = type === "number" ? text : sanitize(text, "csv");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(sheet: SheetSpec) {
  const lines = [sheet.columns.map((c) => csvValue(c.header, "text")).join(",")];
  for (const row of sheet.rows) lines.push(sheet.columns.map((c, i) => csvValue(row[i], c.type)).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function fileResponse(body: Buffer | string, fileName: string, format: "xlsx" | "csv") {
  const type =
    format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8";
  const ascii = fileName.replace(/[^\w.\- ]+/g, "_");
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
