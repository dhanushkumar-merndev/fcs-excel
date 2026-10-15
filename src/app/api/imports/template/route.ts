import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { requireApiStaff } from "@/lib/api";
import { fileResponse } from "@/lib/export/sheet";
import { MAX_IMPORT_ROWS, TEMPLATE_COLUMNS } from "@/lib/import/template";

const TEXT_COLUMNS = new Set(["id", "ad_id", "adset_id", "campaign_id", "form_id", "phone"]);

/** Downloadable import template with the exact headers; ID and phone columns pre-formatted as Text. */
export async function GET(request: NextRequest) {
  const staff = await requireApiStaff(request, ["admin", "manager"]);
  if (staff instanceof NextResponse) return staff;

  const ws: XLSX.WorkSheet = {};
  TEMPLATE_COLUMNS.forEach((col, c) => {
    ws[XLSX.utils.encode_cell({ r: 0, c })] = { t: "s", v: col.header };
    if (TEXT_COLUMNS.has(col.key)) {
      // Text-format the data cells so Excel never turns long IDs or phones into rounded numbers.
      for (let r = 1; r <= MAX_IMPORT_ROWS; r++) ws[XLSX.utils.encode_cell({ r, c })] = { t: "s", v: "", z: "@" };
    }
  });
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: MAX_IMPORT_ROWS, c: TEMPLATE_COLUMNS.length - 1 } });
  ws["!cols"] = TEMPLATE_COLUMNS.map((c) => ({ wch: Math.max(14, c.header.length + 2) }));

  const notes = XLSX.utils.aoa_to_sheet([
    ["How to use this template"],
    [""],
    ["• Keep the header row exactly as it is. Column order doesn't matter."],
    [`• Up to ${MAX_IMPORT_ROWS} data rows per file. Blank rows are ignored.`],
    ["• Required: full_name and phone. Missing event details are imported and flagged for review."],
    ["• IDs and phone numbers must stay as Text. Values like 1.23457E+18 mean Excel has already lost digits."],
    ["• Phones: +91XXXXXXXXXX, 10-digit Indian numbers, or Meta's p:+91… format are all accepted."],
    ["• Event dates: use full dates (e.g. 2026-11-25 or 25/11/2026). Dates without a year are asked about during import."],
    ["• lead_status CREATED is imported as stage New. CRM UPDATE is kept as a legacy marker only."],
    ["• Re-importing the same file is safe: rows with an already-imported id are skipped."],
  ]);
  notes["!cols"] = [{ wch: 110 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
  XLSX.utils.book_append_sheet(wb, notes, "Instructions");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
  return fileResponse(buffer, "lead-import-template.xlsx", "xlsx");
}
