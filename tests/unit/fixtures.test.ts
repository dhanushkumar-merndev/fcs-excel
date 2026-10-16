/** Runs the generated fixture files through the real parser + cleaning + duplicate pipeline. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseImportFile, rowLimitError } from "@/lib/import/parse";
import { normalizeAll, prepareImport } from "@/lib/import/prepare";
import { autoMapHeaders, TEMPLATE_COLUMNS } from "@/lib/import/template";

const dir = resolve(import.meta.dirname, "../fixtures");
function load(name: string) {
  const buf = readFileSync(resolve(dir, name));
  const parsed = parseImportFile(XLSX, name, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const sheet = parsed.sheets[0];
  const mapping = autoMapHeaders(sheet.headers);
  return { sheet, mapping };
}

describe("fixture files", () => {
  it.each(["valid-1000.xlsx", "valid-1000.csv"])("%s: 1,000 valid rows, all columns mapped, IDs exact", (name) => {
    const { sheet, mapping } = load(name);
    expect(sheet.rows).toHaveLength(1000);
    expect(rowLimitError(sheet.rows.length)).toBeNull();
    for (const col of TEMPLATE_COLUMNS) expect(mapping[col.key]).toBeTruthy();
    const rows = normalizeAll(sheet.rows, mapping, { mode: "after_created" });
    const plan = prepareImport(rows, [], {});
    expect(plan.summary).toMatchObject({ total: 1000, toCreate: 1000, invalid: 0, skippedExact: 0 });
    expect(rows[0].lead.external_lead_id).toBe("l:1202110000000000");
    expect(rows[999].lead.external_lead_id).toBe("l:1202110000000999");
    expect(rows[0].lead.phone_e164).toBe("+919100000000");
    expect(rows[0].lead.campaign_id).toMatch(/^c:1202110000000001\d\d$/);
    expect(rows.every((r) => r.valid)).toBe(true);
    // DD/MM dates with day <= 12 are ambiguous: settled only when exactly one reading falls in the year
    // after the enquiry (and then noted), otherwise flagged. Everything else resolves.
    for (const r of rows) {
      const raw = r.lead.event_date_raw ?? "";
      const ambiguous = /^(\d{2})\/(\d{2})\/\d{4}$/.test(raw) && Number(raw.slice(0, 2)) <= 12 && raw.slice(0, 2) !== raw.slice(3, 5);
      const settled = r.issues.some((i) => i.code === "date_disambiguated");
      expect(r.lead.event_date_status, raw).toBe(ambiguous && !settled ? "needs_review" : "confirmed");
      if (settled) expect(ambiguous, raw).toBe(true);
    }
  });

  it("too-many-1001.xlsx is rejected with a clear message", () => {
    const { sheet } = load("too-many-1001.xlsx");
    expect(sheet.rows).toHaveLength(1001);
    expect(rowLimitError(sheet.rows.length)).toMatch(/1,001 data rows.*limit is 1,000/);
  });

  it("edge-cases.xlsx: messy headers, blank rows, yearless/ambiguous/impossible dates, damaged IDs, duplicates", () => {
    const { sheet, mapping } = load("edge-cases.xlsx");
    expect(mapping).toMatchObject({ id: "ID ", full_name: " Full_Name", phone: "PHONE", crm_update: "crm update " });
    expect(sheet.rows).toHaveLength(13); // two blank rows ignored
    const rows = normalizeAll(sheet.rows, mapping, { mode: "unresolved" });
    const plan = prepareImport(rows, [], {});
    const byName = (n: string) => plan.rows.filter((r) => r.row.lead.customer_name === n);

    const ravi = byName("Ravi Kumar")[0];
    expect(ravi.row.lead).toMatchObject({
      external_lead_id: "l:1234567890123456789",
      phone_e164: "+919991999189",
      phone_raw: "p:+919991999189",
      event_date: null,
      event_date_raw: "29 October",
      is_organic: false,
      legacy_crm_update: "YES",
      source_status: "CREATED",
    });
    expect(plan.yearless).toBeGreaterThanOrEqual(3);
    expect(plan.summary.invalid).toBe(1); // invalid phone; a missing name is imported as "Name not given"

    const damaged = byName("Rounded ID Lead")[0];
    expect(damaged.row.lead).toMatchObject({ external_lead_id: null, external_id_damaged: true });

    const asha = byName("Asha Menon");
    expect(asha).toHaveLength(3);
    expect(asha[0].review.warnings).toHaveLength(0);
    expect(asha[1].review.warnings[0].kind).toBe("repeat_customer");
    expect(asha[2].review.needsDecision).toBe(true);
    expect(byName("Asha Menon (repeat row)")[0].skipReason).toBe("duplicate_in_file");

    const issues = plan.rows.flatMap((r) => r.row.issues.map((i) => i.code));
    expect(issues).toEqual(expect.arrayContaining(["date_no_year", "date_ambiguous", "date_invalid", "id_damaged", "name_missing", "phone_invalid"]));
  });
});
