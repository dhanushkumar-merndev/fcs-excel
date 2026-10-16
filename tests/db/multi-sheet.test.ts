/**
 * Importing several worksheets from one workbook, as the wizard does: one combined preview, then
 * one batch per sheet in workbook order through the real RPCs. Modelled on a real Meta export:
 * an empty "event_date" next to a filled "Event Date ", phones that Excel displays as 9.20E+11,
 * and a franchise form (no event questions) that repeats a lead from the catering sheet.
 */
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { beforeAll, describe, expect, it } from "vitest";
import type { ExistingLead } from "@/lib/import/duplicates";
import { parseImportFile, type ParsedSheet } from "@/lib/import/parse";
import {
  buildStagedRows,
  chunkMatchKeys,
  decisionsForSheet,
  matchKeys,
  normalizeAll,
  normalizeSheets,
  prepareImport,
  summarizeBySheet,
} from "@/lib/import/prepare";
import { autoMapHeaders } from "@/lib/import/template";
import { asUser, createDb, createStaff, type Db } from "./pglite";

const MANAGER = "00000000-0000-4000-8000-0000000000e0";
let db: Db;
let sheets: ParsedSheet[];

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const names = Object.keys(args);
  const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as result`;
  return asUser(db, MANAGER, async (tx) => {
    const values = names.map((n) => (args[n] !== null && typeof args[n] === "object" && !Array.isArray(args[n]) ? JSON.stringify(args[n]) : args[n]));
    return (await tx.query<{ result: T }>(sql, values)).rows[0].result;
  });
}

const findMatches = (keys: ReturnType<typeof matchKeys>) =>
  asUser(db, MANAGER, async (tx) =>
    (await tx.query<ExistingLead>(`select * from public.import_find_matches($1, $2, $3)`, [keys.phones, keys.externalIds, keys.rawIds])).rows,
  );

function workbook() {
  const chef = XLSX.utils.aoa_to_sheet([
    ["id", "created_time", "what's_the_occasion_for_your_event?", "no_of_guests_", "which_menu_needed?", "Event Date ", "event_address", "full_name", "phone", "event_date"],
    ["l:1001", "2026-09-01T10:00:00+05:30", "birthday", "1_-_10", "veg_menu", "2026-11-20", "Indiranagar", "Asha", "p:9845738576", null],
    ["l:1002", "2026-09-02T10:00:00+05:30", "house_party", "11_-_20", "non_veg_menu", "2026-12-05", "Jayanagar", "Manju", 919886829199, null],
  ]);
  chef.J1 = { t: "s", v: "event_date" };
  chef.I3 = { t: "n", v: 919886829199, z: "0.00E+00" }; // shown as 9.20E+11, stored exactly
  const franchise = XLSX.utils.aoa_to_sheet([
    ["id", "created_time", "full_name", "phone", "are_you_ready_to_invest?", "REMARKS"],
    ["l:2001", "2026-09-03T10:00:00+05:30", "Ravi", "p:+919900112233", "yes", "call after 6"],
    ["l:1001", "2026-09-01T10:00:00+05:30", "Asha", "p:9845738576", "no", ""], // already in the chef sheet
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, chef, "CHEF ON DEMAND");
  XLSX.utils.book_append_sheet(wb, franchise, "FRANCHISE PARTNER ");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["id", "full_name", "phone"]]), "LAND SALES");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return parseImportFile(XLSX, "meta.xlsx", out);
}

beforeAll(async () => {
  db = await createDb();
  await createStaff(db, MANAGER, "manager", "Meena");
  sheets = workbook().sheets;
});

describe("multi-sheet import", () => {
  it("matches each sheet on its own, preferring the column that has data", () => {
    const [chef, franchise, land] = sheets;
    expect(land.rows).toHaveLength(0);
    expect(autoMapHeaders(chef.headers, chef.rows).event_date).toBe("Event Date ");
    expect(autoMapHeaders(chef.headers).event_date).toBe("event_date"); // without data, the exact name wins
    const fm = autoMapHeaders(franchise.headers, franchise.rows);
    expect(fm.event_date ?? null).toBeNull();
    expect(fm.full_name).toBe("full_name");
  });

  it("previews all sheets together: cleaned values, cross-sheet duplicates, no event flag on non-event forms", () => {
    const input = sheets.filter((s) => s.rows.length).map((s) => ({ name: s.name, rows: s.rows, mapping: autoMapHeaders(s.headers, s.rows) }));
    const rows = normalizeSheets(input, { mode: "unresolved" });
    expect(rows.map((r) => r.rowNumber)).toEqual([10_000_002, 10_000_003, 20_000_002, 20_000_003]);
    expect(rows.map((r) => r.lead.phone_e164)).toEqual(["+919845738576", "+919886829199", "+919900112233", "+919845738576"]);
    expect(rows[1].lead.phone_raw).toBe("9.20E+11");
    expect(rows[0].lead.event_date).toBe("2026-11-20");
    expect(rows[0].lead.review_flags).toEqual([]);
    expect(rows[2].lead.review_flags).not.toContain("event_details_missing");
    expect(rows[2].original.REMARKS).toBe("call after 6");

    const plan = prepareImport(rows, [], {});
    const repeat = plan.rows[3];
    expect(repeat.status).toBe("skipped");
    expect(repeat.skipReason).toBe("duplicate_in_file");
    expect(repeat.review.warnings[0].reason).toBe("Repeats CHEF ON DEMAND · row 2 of this file (same source lead).");
    expect(summarizeBySheet(plan)).toEqual([
      { sheet: "CHEF ON DEMAND", total: 2, toCreate: 2, skipped: 0, invalid: 0 },
      { sheet: "FRANCHISE PARTNER ", total: 2, toCreate: 1, skipped: 1, invalid: 0 },
    ]);
  });

  it("splits duplicate lookups into requests the API accepts", () => {
    const keys = { phones: Array.from({ length: 2100 }, (_, i) => `+9198${i}`), externalIds: ["l:1"], rawIds: [] };
    const parts = chunkMatchKeys(keys);
    expect(parts.map((p) => [p.phones.length, p.externalIds.length])).toEqual([[1000, 1], [1000, 0], [100, 0]]);
    expect(parts.flatMap((p) => p.phones)).toEqual(keys.phones);
    expect(chunkMatchKeys({ phones: [], externalIds: [], rawIds: [] })).toHaveLength(1);
  });

  it("splits reviewer decisions back to each sheet's own rows", () => {
    const decisions = { 10_000_002: "skip", 20_000_003: "import", 20_000_002: "skip" } as const;
    expect(decisionsForSheet(decisions, 0, 2)).toEqual({ 2: "skip" });
    expect(decisionsForSheet(decisions, 1, 2)).toEqual({ 3: "import", 2: "skip" });
    expect(decisionsForSheet({ 5: "skip" }, 0, 1)).toEqual({ 5: "skip" });
  });

  it("imports one batch per sheet in order; the repeated lead is skipped and linked, not duplicated", async () => {
    const batches: { sheet: string; progress: Record<string, number> }[] = [];
    for (const sheet of sheets.filter((s) => s.rows.length)) {
      // Exactly what POST /api/imports does for one sheet.
      const mapping = autoMapHeaders(sheet.headers, sheet.rows);
      const normalized = normalizeAll(sheet.rows, mapping, { mode: "unresolved" });
      const plan = prepareImport(normalized, await findMatches(matchKeys(normalized)), {});
      const batch = await rpc<{ id: string }>("import_create_batch", {
        p_client_token: randomUUID(),
        p_meta: { file_name: "meta.xlsx", sheet_name: sheet.name, total_rows: plan.rows.length },
      });
      await rpc("import_stage_rows", { p_batch_id: batch.id, p_rows: JSON.stringify(buildStagedRows(plan)) });
      let progress: Record<string, number> = {};
      do progress = await rpc("import_process_rows", { p_batch_id: batch.id, p_limit: 100 });
      while (progress.pending > 0);
      batches.push({ sheet: sheet.name, progress });
    }
    expect(batches.map((b) => [b.sheet, b.progress.created, b.progress.skipped])).toEqual([
      ["CHEF ON DEMAND", 2, 0],
      ["FRANCHISE PARTNER ", 1, 1],
    ]);
    const leads = (await db.query<{ external_lead_id: string; review_flags: string[] }>(`select external_lead_id, review_flags from public.leads order by external_lead_id`)).rows;
    expect(leads.map((l) => l.external_lead_id)).toEqual(["l:1001", "l:1002", "l:2001"]);
    expect(leads.find((l) => l.external_lead_id === "l:2001")?.review_flags).toEqual([]);
    const linked = (
      await db.query<{ lead_id: string | null; skip_reason: string | null }>(
        `select r.lead_id, r.skip_reason from public.import_rows r join public.import_batches b on b.id = r.batch_id
          where b.sheet_name = 'FRANCHISE PARTNER ' and r.status = 'skipped'`,
      )
    ).rows;
    expect(linked).toHaveLength(1);
    expect(linked[0].lead_id).not.toBeNull();
  });
});
