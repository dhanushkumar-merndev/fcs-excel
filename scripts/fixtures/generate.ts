/**
 * Generates import test files in tests/fixtures/. Clearly fake demo data (example names, 9xxxx numbers).
 *   pnpm fixtures
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { repoRoot } from "../supabase/env";

const OUT = resolve(repoRoot, "tests/fixtures");
mkdirSync(OUT, { recursive: true });

const HEADERS = [
  "id", "created_time", "ad_id", "ad_name", "adset_id", "adset_name", "campaign_id", "campaign_name", "form_id", "form_name",
  "is_organic", "platform", "what's_the_occasion_for_your_event?", "no_of_guests_", "which_menu_needed?", "event_date",
  "event_address", "full_name", "phone", "lead_status", "CRM UPDATE",
];

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];

const FIRST = ["Aarav", "Diya", "Ishaan", "Kavya", "Rohan", "Ananya", "Vikram", "Meera", "Arjun", "Sneha", "Karthik", "Priya", "Rahul", "Lakshmi", "Nikhil", "Pooja"];
const LAST = ["Sharma", "Iyer", "Reddy", "Nair", "Gupta", "Menon", "Rao", "Patel", "Kumar", "Pillai", "Das", "Joshi"];
const OCCASIONS = ["birthday", "house_party", "anniversary", "corporate_event", "puja", "kitty_party", "wedding"];
const GUESTS = ["1_-_10", "11_-_20", "21_-_30", "more_than_30"];
const MENUS = ["veg_menu", "non_veg_menu", "veg_and_non_veg"];
const AREAS = ["Koramangala, Bengaluru", "Indiranagar, Bengaluru", "HSR Layout, Bengaluru", "Whitefield, Bengaluru", "Adyar, Chennai", "Banjara Hills, Hyderabad", "Bandra West, Mumbai"];
const CAMPAIGNS = [
  { id: "c:120211000000000101", name: "Diwali Parties 2026" },
  { id: "c:120211000000000102", name: "Weekend Chef at Home" },
  { id: "c:120211000000000103", name: "Corporate Lunches" },
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function isoIST(d: Date) {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 19) + "+05:30";
}

function row(i: number, opts: { idBase?: bigint } = {}) {
  const campaign = pick(CAMPAIGNS);
  const created = new Date(Date.UTC(2026, 8, 1) + Math.floor(rand() * 44 * 86_400_000));
  const event = new Date(created.getTime() + (7 + Math.floor(rand() * 80)) * 86_400_000);
  const style = rand();
  const eventText =
    style < 0.6
      ? event.toISOString().slice(0, 10)
      : style < 0.8
        ? `${String(event.getUTCDate()).padStart(2, "0")}/${String(event.getUTCMonth() + 1).padStart(2, "0")}/${event.getUTCFullYear()}`
        : `${event.getUTCDate()} ${MONTHS[event.getUTCMonth()]}`;
  const phone = `p:+919${String(100000000 + i).padStart(9, "0")}`;
  const id = (opts.idBase ?? 1202110000000000n) + BigInt(i);
  return [
    `l:${id}`,
    isoIST(created),
    `ag:1202110000${String(500000 + (i % 7)).padStart(8, "0")}`,
    `Ad ${(i % 7) + 1} - ${campaign.name}`,
    `as:1202110000${String(400000 + (i % 3)).padStart(8, "0")}`,
    `${campaign.name} - Audience ${(i % 3) + 1}`,
    campaign.id,
    campaign.name,
    `f:${String(900000000000000 + (i % 2))}`,
    i % 2 ? "Chef booking form" : "Catering enquiry form",
    rand() < 0.15 ? "true" : "false",
    rand() < 0.65 ? "ig" : "fb",
    pick(OCCASIONS),
    pick(GUESTS),
    pick(MENUS),
    eventText,
    pick(AREAS),
    `${pick(FIRST)} ${pick(LAST)}`,
    phone,
    "CREATED",
    rand() < 0.2 ? "YES" : "",
  ];
}

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
