/**
 * Google Sheet sync end to end: the real runSheetSync against the real migrations, called the way
 * the API route calls it (service_role, no user session), with the sheet's CSV supplied by the test.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";
import { SheetSyncError } from "@/lib/sheet-sync/plan";
import { runSheetSync } from "@/lib/sheet-sync/run";
import { asService, asUser, createDb, createStaff, type Db } from "./pglite";

const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const SALES = "00000000-0000-4000-8000-0000000000a2";
const SECRET = "test-cron-secret";
const HEADERS = ["id", "created_time", "what's_the_occasion_for_your_event?", "no_of_guests_", "which_menu_needed?", "event_date", "event_address", "full_name", "phone"];

let db: Db;
let sheet: string[][];

const SET_RETURNING = new Set(["sheet_sync_missing_keys", "sheet_sync_find_matches"]);

/** The slice of supabase-js that runSheetSync uses, backed by PGlite as service_role. */
function serviceClient(): SupabaseClient {
  return {
    async rpc(fn: string, args: Record<string, unknown>) {
      const names = Object.keys(args);
      const values = names.map((n) => {
        const v = args[n];
        if (v !== null && typeof v === "object" && (!Array.isArray(v) || typeof v[0] === "object")) return JSON.stringify(v);
        return v;
      });
      const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})`;
      // Rows come back as JSON, like PostgREST (dates as "YYYY-MM-DD" strings).
      const sql = SET_RETURNING.has(fn)
        ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]') as result from ${call} t`
        : `select ${call} as result`;
      try {
        const res = await asService(db, (tx) => tx.query<{ result: unknown }>(sql, values));
        return { data: res.rows[0].result, error: null };
      } catch (error) {
        const e = error as { code?: string; message?: string };
        return { data: null, error: { code: e.code, message: e.message } };
      }
    },
  } as unknown as SupabaseClient;
}

const csvOf = (rows: string[][]) => [HEADERS, ...rows].map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
const csv = () => [HEADERS, ...sheet].map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");

/** The sheet's tabs as Google lists them; tab "1" is `sheet`, any other tab is in `otherTabs`. */
let tabList: { gid: string; name: string }[];
let otherTabs: Record<string, string>;

const sync = async (overrides: Partial<Parameters<typeof runSheetSync>[1]> = {}) => {
  await due();
  return runSync(overrides);
};

const runSync = (overrides: Partial<Parameters<typeof runSheetSync>[1]> = {}) =>
  runSheetSync(serviceClient(), {
    secret: SECRET,
    manual: false,
    deadline: Date.now() + 30_000,
    fetchCsv: async (_id, gid) => (gid === "1" ? csv() : (otherTabs[gid!] ?? "")),
    listTabs: async () => tabList,
    ...overrides,
  });

/** Lets the next scheduled run through (runs wait for the chosen interval). */
const due = () => db.exec(`update public.sheet_sync set last_started_at = now() - interval '1 hour'`);

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const count = async (sql: string) => Number((await one<{ n: number }>(sql)).n);

const lead = (id: string, name: string, phone: string, date = "2026-12-20", occasion = "birthday") =>
  [`l:${id}`, "2026-10-01T10:00:00+05:30", occasion, "11_-_20", "veg_menu", date, "Indiranagar, Bengaluru", name, `p:${phone}`];

// Lead history is append-only, so each test gets a fresh database.
beforeEach(async () => {
  db = await createDb();
  await createStaff(db, ADMIN, "admin", "Gayathri");
  await createStaff(db, SALES, "salesperson", "Ravi");
  await db.query(
    `update public.sheet_sync set enabled = true, sheet_id = 'sheet', actor_id = $1,
       cron_secret_sha256 = encode(sha256(convert_to($2, 'UTF8')), 'hex')`,
    [ADMIN, SECRET],
  );
  tabList = [{ gid: "1", name: "Leads" }];
  otherTabs = {};
  sheet = [lead("1001", "Asha", "+919845738576"), lead("1002", "Manju", "+919886829199"), lead("1003", "No phone", "")];
});

describe("sheet sync", () => {
  it("refuses a wrong secret, and does nothing while disabled", async () => {
    expect(await sync({ secret: "nope" })).toEqual({ status: "skipped", reason: "unauthorized" });
    expect(await sync({ secret: null })).toEqual({ status: "skipped", reason: "unauthorized" });
    await db.exec(`update public.sheet_sync set enabled = false`);
    expect(await sync()).toEqual({ status: "skipped", reason: "disabled" });
    expect(await count(`select count(*) n from public.leads`)).toBe(0);
  });

  it("imports new rows as the sync actor, records status, and sends no per-run notification", async () => {
    const result = await sync();
    expect(result).toMatchObject({ status: "ok", created: 2, skipped: 0, invalid: 1, continuesNextRun: false });

    const batch = await one<{ origin: string; uploaded_by: string; total_rows: number; status: string }>(
      `select origin, uploaded_by, total_rows, status from public.import_batches`,
    );
    expect(batch).toEqual({ origin: "sheet_sync", uploaded_by: ADMIN, total_rows: 3, status: "completed" });
    const leads = (await db.query<{ external_lead_id: string; created_by: string }>(`select external_lead_id, created_by from public.leads order by 1`)).rows;
    expect(leads).toEqual([
      { external_lead_id: "l:1001", created_by: ADMIN },
      { external_lead_id: "l:1002", created_by: ADMIN },
    ]);
    expect(await count(`select count(*) n from public.notifications`)).toBe(0);

    const state = await one<Record<string, unknown>>(
      `select last_status, last_created, last_invalid, running_since, run_token, last_synced_at is not null as synced from public.sheet_sync`,
    );
    expect(state).toEqual({ last_status: "ok", last_created: 2, last_invalid: 1, running_since: null, run_token: null, synced: true });
    const tab = await one<Record<string, unknown>>(`select name, last_status, last_created, processed_through_row, enabled from public.sheet_sync_tabs`);
    expect(tab).toEqual({ name: "Leads", last_status: "ok", last_created: 2, processed_through_row: 4, enabled: true });
    const sheetName = await one<{ sheet_name: string }>(`select sheet_name from public.import_batches`);
    expect(sheetName.sheet_name).toBe("Leads");
  });

  it("does nothing for an unchanged sheet, and only imports appended rows", async () => {
    await sync();
    expect(await sync()).toMatchObject({ status: "unchanged" });
    expect(await count(`select count(*) n from public.import_batches`)).toBe(1);

    sheet.push(lead("1004", "Divya", "+919900112233"));
    expect(await sync()).toMatchObject({ status: "ok", created: 1, invalid: 0 });
    // The new batch holds only the appended row; old rows (incl. the invalid one) aren't re-reported.
    const totals = (await db.query<{ total_rows: number }>(`select total_rows from public.import_batches order by created_at`)).rows.map((b) => b.total_rows);
    expect(totals).toEqual([3, 1]);
    expect(await count(`select count(*) n from public.leads`)).toBe(3);
  });

  it("skips rows already in the CRM without staging them, and possible duplicate events with a reason", async () => {
    await sync();
    // Same Meta lead appears again (e.g. copied into another row): nothing new to stage.
    sheet.push(lead("1001", "Asha", "+919845738576"));
    expect(await sync()).toMatchObject({ status: "ok", created: 0 });
    expect(await count(`select count(*) n from public.import_batches`)).toBe(1);

    // New Meta lead, but same phone and same event as Manju's: skipped, kept in the batch report.
    sheet.push(lead("2002", "Manju again", "+919886829199"));
    expect(await sync()).toMatchObject({ status: "ok", created: 0, skipped: 1 });
    const row = await one<{ status: string; skip_reason: string }>(
      `select r.status, r.skip_reason from public.import_rows r join public.import_batches b on b.id = r.batch_id
        order by b.created_at desc, r.row_number desc limit 1`,
    );
    expect(row).toEqual({ status: "skipped", skip_reason: "sync_possible_duplicate" });

    // Same phone, different event: a repeat customer is a new enquiry.
    sheet.push(lead("3003", "Manju", "+919886829199", "2027-02-14", "anniversary"));
    expect(await sync()).toMatchObject({ status: "ok", created: 1 });
    expect(await count(`select count(*) n from public.leads where phone_e164 = '+919886829199'`)).toBe(2);
  });

  it("rechecks old rows after an edit: a fixed phone is imported, nothing is duplicated", async () => {
    await sync();
    sheet[2] = lead("1003", "Phone added", "+919811122233");
    sheet[0][7] = "Asha K"; // a cosmetic edit to an imported row changes nothing in the CRM
    expect(await sync()).toMatchObject({ status: "ok", created: 1, summary: { rescanned: true, alreadyInCrm: 2 } });
    expect(await count(`select count(*) n from public.leads`)).toBe(3);
    expect(await sync()).toMatchObject({ status: "unchanged" });
  });

  it("allows one run at a time", async () => {
    const first = await asService(db, async (tx) =>
      (await tx.query<{ r: { claimed: boolean } }>(`select public.sheet_sync_claim($1) r`, [SECRET])).rows[0].r,
    );
    expect(first.claimed).toBe(true);
    expect(await sync()).toEqual({ status: "skipped", reason: "busy" });
    // A run that died is taken over after 5 minutes.
    await db.exec(`update public.sheet_sync set running_since = now() - interval '6 minutes'`);
    expect(await sync()).toMatchObject({ status: "ok", created: 2 });
  });

  it("records failures without touching data, and tells admins once after 3 in a row", async () => {
    const failing = { fetchCsv: async () => Promise.reject(new SheetSyncError("Google wouldn't let the CRM read the sheet.")) };
    for (let i = 0; i < 4; i++) expect(await sync(failing)).toMatchObject({ status: "error", message: "Google wouldn't let the CRM read the sheet." });
    const state = await one<Record<string, unknown>>(`select last_status, consecutive_failures, running_since from public.sheet_sync`);
    expect(state).toEqual({ last_status: "error", consecutive_failures: 4, running_since: null });
    expect(await count(`select count(*) n from public.notifications where recipient_id = '${ADMIN}' and type = 'system'`)).toBe(1);
    expect(await count(`select count(*) n from public.leads`)).toBe(0);

    expect(await sync()).toMatchObject({ status: "ok" });
    expect(await one(`select consecutive_failures, last_error from public.sheet_sync`)).toEqual({ consecutive_failures: 0, last_error: null });
  });

  it("rejects a sheet without the required columns", async () => {
    const result = await sync({ fetchCsv: async () => "id,name\nl:1,Asha" });
    expect(result).toMatchObject({ status: "error", message: "The sheet has no phone column, so nothing was imported. Check its header row." });
  });

  it("lets staff read the status but not the configuration, and keeps the sync RPCs server-only", async () => {
    const visible = await asUser(db, SALES, async (tx) => (await tx.query(`select last_status, enabled from public.sheet_sync`)).rows);
    expect(visible).toHaveLength(1);
    await expect(asUser(db, ADMIN, (tx) => tx.query(`select sheet_id from public.sheet_sync`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ADMIN, (tx) => tx.query(`select public.sheet_sync_claim(null, true)`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ADMIN, (tx) => tx.query(`update public.sheet_sync set enabled = false`))).rejects.toThrow(/permission denied/);
  });

  it("reads every tab, picks up tabs added later, and records each tab", async () => {
    tabList = [{ gid: "1", name: "Leads" }, { gid: "2", name: "CATERING LEADS" }];
    otherTabs["2"] = csvOf([lead("5001", "Kavya", "+919900000001")]);
    const first = await sync();
    expect(first).toMatchObject({ status: "ok", created: 3 });
    expect(first.status === "ok" && first.tabs.map((t) => [t.name, t.status, t.created])).toEqual(
      expect.arrayContaining([
        ["Leads", "ok", 2],
        ["CATERING LEADS", "ok", 1],
      ]),
    );
    const names = (await db.query<{ sheet_name: string }>(`select sheet_name from public.import_batches order by sheet_name`)).rows.map((r) => r.sheet_name);
    expect(names).toEqual(["CATERING LEADS", "Leads"]);

    // A new tab: its own new lead is imported; a lead already imported from another tab is not.
    tabList.push({ gid: "3", name: "LAND SALES" });
    otherTabs["3"] = csvOf([lead("1001", "Asha", "+919845738576"), lead("6001", "Ravi K", "+919900000002", "2027-01-10")]);
    expect(await sync()).toMatchObject({ status: "ok", created: 1 });
    expect(await count(`select count(*) n from public.leads`)).toBe(4);

    // Renamed and deleted tabs.
    tabList = [{ gid: "1", name: "Leads (old)" }, { gid: "3", name: "LAND SALES" }];
    expect(await sync()).toMatchObject({ status: "unchanged" });
    const tabs = (await db.query(`select gid, name, removed from public.sheet_sync_tabs order by gid`)).rows;
    expect(tabs).toEqual([
      { gid: "1", name: "Leads (old)", removed: false },
      { gid: "2", name: "CATERING LEADS", removed: true },
      { gid: "3", name: "LAND SALES", removed: false },
    ]);
  });

  it("keeps going when one tab can't be used, and treats an empty tab as nothing to do", async () => {
    tabList = [{ gid: "1", name: "Leads" }, { gid: "2", name: "Notes" }, { gid: "3", name: "Empty" }];
    otherTabs["2"] = "id,name\nl:9,Somebody";
    otherTabs["3"] = "";
    const result = await sync();
    expect(result).toMatchObject({ status: "ok", created: 2 });
    const tabs = (await db.query(`select name, last_status, last_error from public.sheet_sync_tabs order by gid`)).rows;
    expect(tabs).toEqual([
      { name: "Leads", last_status: "ok", last_error: null },
      { name: "Notes", last_status: "error", last_error: "The sheet has no phone column, so nothing was imported. Check its header row." },
      { name: "Empty", last_status: "ok", last_error: null },
    ]);
    expect(await one(`select last_status, consecutive_failures from public.sheet_sync`)).toEqual({ last_status: "ok", consecutive_failures: 0 });
  });

  it("waits for the chosen interval between scheduled runs; Sync now doesn't wait", async () => {
    await sync();
    expect(await runSync()).toEqual({ status: "skipped", reason: "not_due" });
    expect(await runSync({ secret: null, manual: true })).toMatchObject({ status: "unchanged" });
    await db.exec(`update public.sheet_sync set interval_minutes = 5, last_started_at = now() - interval '4 minutes 30 seconds'`);
    expect(await runSync()).toMatchObject({ status: "unchanged" });
  });

  it("is set up from the app by an admin or manager: sheet, ticked tabs and interval", async () => {
    const SHEET = "1uE52SYaoXvhcoYIpg6kznf5WvoS9p5EVBr2WT9xTYkA";
    const configure = (user: string, allTabs: boolean, tabs: { gid: string; name: string; enabled: boolean }[], interval = 15) =>
      asUser(db, user, async (tx) =>
        (
          await tx.query<{ r: { tabs: { gid: string; enabled: boolean }[]; interval_minutes: number; actor_name: string } }>(
            `select public.sheet_sync_configure($1, $2, $3, $4, true) r`,
            [SHEET, allTabs, JSON.stringify(tabs), interval],
          )
        ).rows[0].r,
      );

    await expect(configure(SALES, true, [{ gid: "1", name: "Leads", enabled: true }])).rejects.toThrow(/Only an admin or manager/);
    const saved = await configure(ADMIN, false, [
      { gid: "1", name: "Leads", enabled: true },
      { gid: "2", name: "Webinar", enabled: false },
    ]);
    expect(saved).toMatchObject({ interval_minutes: 15, actor_name: "Gayathri" });
    expect(saved.tabs.map((t) => [t.gid, t.enabled])).toEqual([
      ["1", true],
      ["2", false],
    ]);
    await expect(configure(ADMIN, false, [{ gid: "1", name: "Leads", enabled: false }])).rejects.toThrow(/Tick at least one tab/);

    // Unticked tabs aren't read; a tab added later stays off while "all tabs" is off.
    tabList = [{ gid: "1", name: "Leads" }, { gid: "2", name: "Webinar" }, { gid: "3", name: "New tab" }];
    const read: string[] = [];
    await sync({ fetchCsv: async (_id, gid) => (read.push(gid!), gid === "1" ? csv() : "") });
    expect(read).toEqual(["1"]);
    expect(await one(`select enabled from public.sheet_sync_tabs where gid = '3'`)).toEqual({ enabled: false });

    // Staff can see each tab's status, never the sheet link.
    const visible = await asUser(db, SALES, async (tx) => (await tx.query(`select name, last_status from public.sheet_sync_tabs order by gid`)).rows);
    expect(visible).toHaveLength(3);
    await expect(asUser(db, SALES, (tx) => tx.query(`select public.sheet_sync_settings()`))).rejects.toThrow(/Only an admin or manager/);
    await expect(asUser(db, ADMIN, (tx) => tx.query(`select content_hash from public.sheet_sync_tabs`))).rejects.toThrow(/permission denied/);
  });
});
