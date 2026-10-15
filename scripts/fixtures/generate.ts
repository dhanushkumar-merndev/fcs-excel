/**
 * Generates import test files in tests/fixtures/. Clearly fake demo data (example names, 9xxxx numbers).
 *   pnpm fixtures
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { repoRoot } from "../supabase/env";
import { HEADERS, row } from "./rows";

const OUT = resolve(repoRoot, "tests/fixtures");
mkdirSync(OUT, { recursive: true });



function textSheet(rows: (string | number | null)[][]) {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  // Store everything as text cells, like a properly formatted export.
  for (const key of Object.keys(ws)) {
    if (key.startsWith("!")) continue;
    const cell = ws[key] as XLSX.CellObject;
    if (cell.t === "n") {
      cell.t = "s";
      cell.v = String(cell.v);
    }
  }
  return ws;
}

function writeXlsx(name: string, ws: XLSX.WorkSheet, sheetName = "Leads") {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  writeFileSync(resolve(OUT, name), XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
  console.log(`  tests/fixtures/${name}`);
}

console.log("Writing fixtures:");
const thousand = Array.from({ length: 1000 }, (_, i) => row(i));
writeXlsx("valid-1000.xlsx", textSheet(thousand));
writeFileSync(
  resolve(OUT, "valid-1000.csv"),
  [HEADERS, ...thousand].map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""))).join(",")).join("\n"),
);
console.log("  tests/fixtures/valid-1000.csv");

const thousandOne = Array.from({ length: 1001 }, (_, i) => row(i, { idBase: 1202119000000000n }));
writeXlsx("too-many-1001.xlsx", textSheet(thousandOne));

// Edge cases from the spec, with messy headers and blank rows.
const messyHeaders = HEADERS.map((h) => (h === "id" ? "ID " : h === "full_name" ? " Full_Name" : h === "phone" ? "PHONE" : h === "CRM UPDATE" ? "crm update " : h));
const base = (overrides: Partial<Record<string, string | number>>, i: number) => {
  const r = row(5000 + i, { idBase: 1202117000000000n });
  return HEADERS.map((h, idx) => (h in overrides ? overrides[h]! : r[idx]));
};
const edge: (string | number | null)[][] = [
  base({ id: "l:1234567890123456789", phone: "p:+919991999189", full_name: "Ravi Kumar", event_date: "29 October", "what's_the_occasion_for_your_event?": "house_party", "no_of_guests_": "1_-_10", "which_menu_needed?": "veg_menu", is_organic: "false", platform: "ig", lead_status: "CREATED", "CRM UPDATE": "YES" }, 1),
  base({ event_date: "25 nov", "no_of_guests_": "more_than_30" }, 2),
  base({ event_date: "31 oct" }, 3),
  HEADERS.map(() => ""),
  base({ event_date: "31 nov" }, 4),
  base({ event_date: "05/10/2025" }, 5),
  base({ full_name: "" }, 6),
  base({ phone: "12345" }, 7),
  HEADERS.map(() => ""),
  base({ id: "l:1202117000000000100", phone: "p:+919811100001", full_name: "Asha Menon", event_date: "2026-11-02", "what's_the_occasion_for_your_event?": "birthday" }, 8),
  base({ id: "l:1202117000000000101", phone: "p:+919811100001", full_name: "Asha Menon", event_date: "2026-12-20", "what's_the_occasion_for_your_event?": "anniversary" }, 9),
  base({ id: "l:1202117000000000102", phone: "p:+919811100001", full_name: "Asha Menon", event_date: "2026-11-02", "what's_the_occasion_for_your_event?": "birthday" }, 10),
  base({ id: "l:1202117000000000100", phone: "p:+919811100001", full_name: "Asha Menon (repeat row)", event_date: "2026-11-02" }, 11),
  base({ event_date: "", "what's_the_occasion_for_your_event?": "", event_address: "" }, 12),
];
const edgeWs = XLSX.utils.aoa_to_sheet([messyHeaders, ...edge]);
for (const key of Object.keys(edgeWs)) {
  if (!key.startsWith("!") && (edgeWs[key] as XLSX.CellObject).t === "n") {
    (edgeWs[key] as XLSX.CellObject).t = "s";
    (edgeWs[key] as XLSX.CellObject).v = String((edgeWs[key] as XLSX.CellObject).v);
  }
}
// One ID damaged by Excel: a 19-digit number stored as a numeric cell.
const damagedRow = edge.length + 1;
const damagedCell = XLSX.utils.encode_cell({ r: damagedRow, c: 0 });
XLSX.utils.sheet_add_aoa(edgeWs, [base({ full_name: "Rounded ID Lead", phone: "p:+919822200002" }, 13)], { origin: damagedRow });
edgeWs[damagedCell] = { t: "n", v: 1234567890123456789, z: "General" };
writeXlsx("edge-cases.xlsx", edgeWs);
console.log("Done.");
