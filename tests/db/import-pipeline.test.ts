/**
 * End-to-end import pipeline on the real schema: fixture file → parse → clean → duplicate review
 * against the database → stage → chunked processing, exactly as POST /api/imports and
 * /api/imports/[id]/process do it (same functions, same RPCs, as a signed-in manager).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { beforeAll, describe, expect, it } from "vitest";
import type { YearChoice } from "@/lib/import/dates";
import type { ExistingLead } from "@/lib/import/duplicates";
import { parseImportFile, rowLimitError } from "@/lib/import/parse";
import { buildStagedRows, matchKeys, normalizeAll, prepareImport, type Decision } from "@/lib/import/prepare";
import { autoMapHeaders } from "@/lib/import/template";
import { asUser, createDb, createStaff, type Db } from "./pglite";

const MANAGER = "00000000-0000-4000-8000-0000000000b0";
const SALES = "00000000-0000-4000-8000-0000000000c0";
const OTHER_SALES = "00000000-0000-4000-8000-0000000000d0";
let db: Db;

async function rpc<T>(user: string, fn: string, args: Record<string, unknown>): Promise<T> {
  const names = Object.keys(args);
  const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as result`;
  return asUser(db, user, async (tx) => {
    const values = names.map((n) => (args[n] !== null && typeof args[n] === "object" && !Array.isArray(args[n]) ? JSON.stringify(args[n]) : args[n]));
    return (await tx.query<{ result: T }>(sql, values)).rows[0].result;
  });
}

async function findMatches(keys: ReturnType<typeof matchKeys>) {
  return asUser(db, MANAGER, async (tx) =>
    (await tx.query<ExistingLead>(`select * from public.import_find_matches($1, $2, $3)`, [keys.phones, keys.externalIds, keys.rawIds])).rows,
  );
}

function readFixture(name: string) {
  const buf = readFileSync(resolve(import.meta.dirname, "../fixtures", name));
  const parsed = parseImportFile(XLSX, name, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  return parsed.sheets[0];
}

/** Mirrors POST /api/imports: server-side re-validation, then idempotent staging. */
async function stage(name: string, opts: { yearChoice?: YearChoice; decisions?: Record<number, Decision>; owner?: string | null; token?: string } = {}) {
  const sheet = readFixture(name);
  const limit = rowLimitError(sheet.rows.length);
  if (limit) return { limit };
  const mapping = autoMapHeaders(sheet.headers);
  const normalized = normalizeAll(sheet.rows, mapping, opts.yearChoice ?? { mode: "unresolved" });
  const plan = prepareImport(normalized, await findMatches(matchKeys(normalized)), opts.decisions ?? {});
  if (plan.summary.undecided > 0) return { undecided: plan.summary.undecided, plan };
  const batch = await rpc<{ id: string }>(MANAGER, "import_create_batch", {
    p_client_token: opts.token ?? randomUUID(),
    p_meta: { file_name: name, total_rows: plan.rows.length, default_owner_id: opts.owner ?? null },
  });
  await rpc(MANAGER, "import_stage_rows", { p_batch_id: batch.id, p_rows: JSON.stringify(buildStagedRows(plan)) });
  return { batchId: batch.id, plan };
}

/** Mirrors the client loop over POST /api/imports/[id]/process. */
async function processAll(batchId: string, maxChunks = Infinity) {
  let progress: Record<string, number | string> = {};
  for (let i = 0; i < maxChunks; i++) {
    progress = await rpc(MANAGER, "import_process_rows", { p_batch_id: batchId, p_limit: 100 });
    if (progress.pending === 0) break;
  }
  return progress;
}

beforeAll(async () => {
  db = await createDb();
  await createStaff(db, MANAGER, "manager", "Manoj");
  await createStaff(db, SALES, "salesperson", "Sana");
  await createStaff(db, OTHER_SALES, "salesperson", "Omar");
}, 120_000);

describe("import pipeline", () => {
  let firstBatch: string;

  it("imports 1,000 valid leads with exact IDs and phones", async () => {
    const staged = await stage("valid-1000.xlsx", { yearChoice: { mode: "after_created" }, owner: SALES });
    firstBatch = staged.batchId!;
    const progress = await processAll(firstBatch);
    expect(progress).toMatchObject({ status: "completed", total: 1000, created: 1000, skipped: 0, invalid: 0, failed: 0, pending: 0 });
    const [lead] = (await db.query<Record<string, unknown>>(`select external_lead_id, phone_e164, phone_raw, campaign_id, stage, source_status, owner_id from public.leads where import_row_number = 2 and import_batch_id = $1`, [firstBatch])).rows;
    expect(lead).toMatchObject({ external_lead_id: "l:1202110000000000", phone_e164: "+919100000000", phone_raw: "p:+919100000000", stage: "new", source_status: "CREATED", owner_id: SALES });
    // Ownership grants access immediately; another salesperson sees none of them.
    const seen = await asUser(db, SALES, async (tx) => (await tx.query(`select count(*)::int n from public.leads`)).rows[0]);
    expect(seen).toEqual({ n: 1000 });
    const other = await asUser(db, OTHER_SALES, async (tx) => (await tx.query(`select count(*)::int n from public.leads`)).rows[0]);
    expect(other).toEqual({ n: 0 });
  });

  it("rejects the 1,001-row file before anything is saved", async () => {
    const result = await stage("too-many-1001.xlsx");
    expect(result.limit).toMatch(/1,001 data rows/);
  });

  it("requires an explicit decision for a possible duplicate event", async () => {
    const staged = await stage("edge-cases.xlsx");
    expect(staged.undecided).toBeGreaterThan(0);
  });

  it("re-importing the same leads (as CSV) creates no extra records and links existing ones", async () => {
    const staged = await stage("valid-1000.csv");
    expect(staged.plan!.summary.skippedExact).toBe(1000);
    const progress = await processAll(staged.batchId!);
    expect(progress).toMatchObject({ created: 0, skipped: 1000, failed: 0 });
    const [{ n }] = (await db.query<{ n: number }>(`select count(*)::int n from public.leads`)).rows;
    expect(n).toBe(1000);
    const [{ linked }] = (await db.query<{ linked: number }>(`select count(*)::int linked from public.import_rows where batch_id = $1 and lead_id is not null`, [staged.batchId])).rows;
    expect(linked).toBe(1000);
  });

  it("is idempotent for a retried submission (same client token)", async () => {
    const token = randomUUID();
    const a = await stage("edge-cases.xlsx", { token, decisions: { 13: "import" } });
    const b = await stage("edge-cases.xlsx", { token, decisions: { 13: "import" } });
    expect(b.batchId).toBe(a.batchId);
    const [{ n }] = (await db.query<{ n: number }>(`select count(*)::int n from public.import_rows where batch_id = $1`, [a.batchId])).rows;
    expect(n).toBe(13);
    await processAll(a.batchId!);
  });

  it("edge cases: invalid rows excluded, duplicates handled, two genuine events kept separate, yearless dates flagged", async () => {
    const [{ asha }] = (await db.query<{ asha: number }>(`select count(*)::int asha from public.leads where phone_e164 = '+919811100001'`)).rows;
    expect(asha).toBe(3); // two genuine events + the same-date event the reviewer chose to keep
    const [ravi] = (await db.query<Record<string, unknown>>(`select external_lead_id, event_date, event_date_status, event_date_raw, review_flags, legacy_crm_update, stage from public.leads where phone_e164 = '+919991999189'`)).rows;
    expect(ravi).toMatchObject({ external_lead_id: "l:1234567890123456789", event_date: null, event_date_status: "needs_review", event_date_raw: "29 October", legacy_crm_update: "YES", stage: "new" });
    expect(ravi.review_flags).toContain("date_needs_review");
    const [damaged] = (await db.query<Record<string, unknown>>(`select external_lead_id, external_lead_id_raw, external_id_damaged from public.leads where customer_name = 'Rounded ID Lead'`)).rows;
    expect(damaged).toMatchObject({ external_lead_id: null, external_id_damaged: true });
    expect(String(damaged.external_lead_id_raw)).toMatch(/E\+18|1234567890123456/);
  });

  it("an interrupted import resumes safely and totals reconcile", async () => {
    // A fresh copy of the 1,000 leads under different IDs, processed in two sessions.
    const sheet = readFixture("valid-1000.xlsx");
    const mapping = autoMapHeaders(sheet.headers);
    for (const row of sheet.rows) {
      const cell = row.cells[mapping.id!];
      row.cells[mapping.id!] = { t: "s", v: String(cell.v).replace("l:12021", "l:99021") };
      const phone = row.cells[mapping.phone!];
      row.cells[mapping.phone!] = { t: "s", v: String(phone.v).replace("p:+919", "p:+918") };
    }
    const normalized = normalizeAll(sheet.rows, mapping, { mode: "unresolved" });
    const plan = prepareImport(normalized, await findMatches(matchKeys(normalized)), {});
    const batch = await rpc<{ id: string }>(MANAGER, "import_create_batch", { p_client_token: randomUUID(), p_meta: { file_name: "resume.xlsx", total_rows: 1000 } });
    await rpc(MANAGER, "import_stage_rows", { p_batch_id: batch.id, p_rows: JSON.stringify(buildStagedRows(plan)) });

    const partial = await processAll(batch.id, 3); // connection "drops" after 3 chunks
    expect(partial).toMatchObject({ created: 300, pending: 700, status: "processing" });
    const resumed = await processAll(batch.id);
    expect(resumed).toMatchObject({ created: 1000, pending: 0, status: "completed" });
    const again = await processAll(batch.id); // retried request after completion
    expect(again).toMatchObject({ created: 1000, pending: 0, processed_now: 0 });
    const [b] = (await db.query<Record<string, number>>(`select total_rows, created_count + skipped_count + invalid_count + failed_count as reconciled from public.import_batches where id = $1`, [batch.id])).rows;
    expect(b.reconciled).toBe(b.total_rows);
  });

  it("report counts reconcile with the underlying leads and exclude skipped imports", async () => {
    const filters = { acquired_from: "2026-01-01", acquired_to: "2027-12-31" };
    const report = await rpc<{ cohort: { total: number } }>(MANAGER, "report_overview", { p_filters: filters });
    const [{ n }] = (await db.query<{ n: number }>(`select count(*)::int n from public.leads`)).rows;
    expect(report.cohort.total).toBe(n);
    const imported = await rpc<{ activity: { imported_by_day: { leads: number }[] } }>(MANAGER, "report_overview", { p_filters: {} });
    const sum = imported.activity.imported_by_day.reduce((s, d) => s + d.leads, 0);
    expect(sum).toBe(n); // all leads here came from imports; the 1,000 skipped re-imports add nothing
  });
});
