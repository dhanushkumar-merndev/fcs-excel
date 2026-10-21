/**
 * Executes the real migrations in PGlite and verifies permissions and workflows as each role.
 * Mirrors what PostgREST does per request: SET ROLE authenticated + JWT sub claim.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, createStaff, type Db } from "./pglite";

const ADMIN = "00000000-0000-4000-8000-00000000000a";
const MANAGER = "00000000-0000-4000-8000-00000000000b";
const SALES_A = "00000000-0000-4000-8000-0000000000a1";
const SALES_B = "00000000-0000-4000-8000-0000000000b1";
const SALES_C = "00000000-0000-4000-8000-0000000000c1";

let db: Db;
let leadA: string; // owned by SALES_A
let leadB: string; // owned by SALES_B

type Row = Record<string, unknown>;

async function rpc<T = Row>(user: string | null, fn: string, args: Record<string, unknown>): Promise<T> {
  const names = Object.keys(args);
  const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as result`;
  return asUser(db, user, async (tx) => {
    const res = await tx.query<{ result: T }>(sql, names.map((n) => serialize(args[n])));
    return res.rows[0]?.result as T;
  });
}

function serialize(value: unknown) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return JSON.stringify(value);
  return value;
}

async function select<T = Row>(user: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  return asUser(db, user, async (tx) => (await tx.query<T>(sql, params)).rows);
}

async function createLead(owner: string | null, phone: string, name = "Customer") {
  const result = await rpc<{ id: string }>(ADMIN, "create_lead", {
    p_request_id: randomUUID(),
    p_lead: { customer_name: name, phone_e164: phone, owner_id: owner, occasion_code: "house_party" },
  });
  return result.id;
}

beforeAll(async () => {
  db = await createDb();
  await createStaff(db, ADMIN, "admin", "Asha");
  await createStaff(db, MANAGER, "manager", "Manoj");
  await createStaff(db, SALES_A, "salesperson", "Anil");
  await createStaff(db, SALES_B, "salesperson", "Bina");
  await createStaff(db, SALES_C, "salesperson", "Chirag");
  leadA = await createLead(SALES_A, "+919991999189", "Ravi Kumar");
  leadB = await createLead(SALES_B, "+919812345678", "Priya Shah");
});

describe("salesperson isolation", () => {
  it("only sees own leads via table and search", async () => {
    const rows = await select<{ id: string }>(SALES_A, `select id from public.leads`);
    expect(rows.map((r) => r.id)).toEqual([leadA]);
    const searched = await select(SALES_A, `select id from public.search_leads($1)`, [JSON.stringify({ q: "98123" })]);
    expect(searched).toHaveLength(0);
    const byId = await select(SALES_A, `select id from public.leads where id = $1`, [leadB]);
    expect(byId).toHaveLength(0);
  });

  it("cannot see child records of another salesperson's lead", async () => {
    await rpc(SALES_B, "add_note", { p_request_id: randomUUID(), p_lead_id: leadB, p_body: "Private note" });
    for (const table of ["lead_notes", "lead_events", "follow_ups", "call_logs", "assignment_history"]) {
      const rows = await select(SALES_A, `select 1 from public.${table} where lead_id = $1`, [leadB]);
      expect(rows, table).toHaveLength(0);
    }
  });

  it("cannot mutate another salesperson's lead through any RPC", async () => {
    const attempts: [string, Record<string, unknown>][] = [
      ["add_note", { p_request_id: randomUUID(), p_lead_id: leadB, p_body: "x" }],
      ["log_call", { p_request_id: randomUUID(), p_lead_id: leadB, p_outcome: "connected" }],
      ["log_dial_action", { p_lead_id: leadB }],
      ["update_lead_details", { p_request_id: randomUUID(), p_lead_id: leadB, p_expected_version: null, p_patch: { customer_name: "Hacked" } }],
      ["change_lead_stage", { p_request_id: randomUUID(), p_lead_id: leadB, p_expected_version: null, p_stage: "contacted" }],
      ["create_follow_up", { p_request_id: randomUUID(), p_lead_id: leadB, p_due_at: new Date(Date.now() + 3600e3).toISOString(), p_purpose: "x" }],
    ];
    for (const [fn, args] of attempts) {
      await expect(rpc(SALES_A, fn, args), fn).rejects.toThrow(/not found or you do not have access/);
    }
  });

  it("cannot write tables directly, reassign, or escalate role", async () => {
    await expect(select(SALES_A, `update public.leads set owner_id = $1 where id = $2`, [SALES_A, leadB])).rejects.toThrow(/permission denied/);
    await expect(select(SALES_A, `update public.profiles set role = 'admin' where id = $1`, [SALES_A])).rejects.toThrow(/permission denied/);
    await expect(select(SALES_A, `insert into public.lead_events (lead_id, event_type) values ($1, 'x')`, [leadA])).rejects.toThrow(/permission denied/);
    await expect(
      rpc(SALES_A, "assign_leads", { p_request_id: randomUUID(), p_lead_ids: [leadB], p_owner_id: SALES_A }),
    ).rejects.toThrow(/Only an admin or manager/);
    await expect(
      rpc(SALES_A, "admin_update_staff", { p_request_id: randomUUID(), p_user_id: SALES_A, p_role: "admin" }),
    ).rejects.toThrow(/Only an admin/);
    await expect(select(SALES_A, `select * from public.import_batches`)).resolves.toHaveLength(0);
  });

  it("anonymous users get nothing", async () => {
    await expect(select(null, `select * from public.leads`)).rejects.toThrow(/permission denied/);
    await expect(rpc(null, "add_note", { p_request_id: randomUUID(), p_lead_id: leadA, p_body: "x" })).rejects.toThrow(/permission denied/);
  });
});

describe("calling and notes", () => {
  it("dial tap records intent only, never a call", async () => {
    await rpc(SALES_A, "log_dial_action", { p_lead_id: leadA });
    const events = await select(SALES_A, `select event_type from public.lead_events where lead_id = $1 and event_type = 'dial_requested'`, [leadA]);
    expect(events).toHaveLength(1);
    const calls = await select(SALES_A, `select 1 from public.call_logs where lead_id = $1`, [leadA]);
    expect(calls).toHaveLength(0);
    const [lead] = await select<{ first_dial_at: string | null; first_call_logged_at: string | null }>(
      SALES_A, `select first_dial_at, first_call_logged_at from public.leads where id = $1`, [leadA]);
    expect(lead.first_dial_at).not.toBeNull();
    expect(lead.first_call_logged_at).toBeNull();
  });

  it("logs outcome, note, follow-up and stage in one step", async () => {
    const due = new Date(Date.now() + 2 * 3600e3).toISOString();
    const result = await rpc<Row>(SALES_A, "log_call", {
      p_request_id: randomUUID(), p_lead_id: leadA, p_outcome: "no_answer", p_note: "Rang twice",
      p_follow_up: { due_at: due, purpose: "Try again in the evening" }, p_new_stage: "contact_attempted",
    });
    expect(result.stage).toBe("contact_attempted");
    const [lead] = await select<Row>(SALES_A, `select next_follow_up_at, first_call_logged_at, stage from public.leads where id = $1`, [leadA]);
    expect(new Date(lead.next_follow_up_at as string).toISOString()).toBe(due);
    expect(lead.first_call_logged_at).not.toBeNull();
    const notes = await select<Row>(SALES_A, `select body, call_log_id from public.lead_notes where lead_id = $1`, [leadA]);
    expect(notes).toHaveLength(1);
    expect(notes[0].call_log_id).not.toBeNull();
  });

  it("is idempotent for retried submissions", async () => {
    const requestId = randomUUID();
    await rpc(SALES_A, "add_note", { p_request_id: requestId, p_lead_id: leadA, p_body: "Same note" });
    const replay = await rpc<Row>(SALES_A, "add_note", { p_request_id: requestId, p_lead_id: leadA, p_body: "Same note" });
    expect(replay.replayed).toBe(true);
    const rows = await select(SALES_A, `select 1 from public.lead_notes where lead_id = $1 and body = 'Same note'`, [leadA]);
    expect(rows).toHaveLength(1);
  });

  it("keeps note revisions and restricts edits to the author", async () => {
    const { id } = await rpc<{ id: string }>(SALES_A, "add_note", { p_request_id: randomUUID(), p_lead_id: leadA, p_body: "Menu: veg" });
    await rpc(SALES_A, "edit_note", { p_request_id: randomUUID(), p_note_id: id, p_expected_version: 1, p_body: "Menu: veg + live counter" });
    const revisions = await select<Row>(SALES_A, `select body, revision from public.lead_note_revisions where note_id = $1`, [id]);
    expect(revisions).toEqual([{ body: "Menu: veg", revision: 1 }]);
    await expect(
      rpc(MANAGER, "edit_note", { p_request_id: randomUUID(), p_note_id: id, p_expected_version: 2, p_body: "x" }),
    ).rejects.toThrow(/Only the author/);
    await expect(
      rpc(SALES_A, "edit_note", { p_request_id: randomUUID(), p_note_id: id, p_expected_version: 1, p_body: "stale" }),
    ).rejects.toThrow(/changed by someone else/);
  });

  it("rejects stale lead edits", async () => {
    const [lead] = await select<{ version: number }>(SALES_A, `select version from public.leads where id = $1`, [leadA]);
    await rpc(SALES_A, "update_lead_details", { p_request_id: randomUUID(), p_lead_id: leadA, p_expected_version: lead.version, p_patch: { guest_range: "11-20" } });
    await expect(
      rpc(SALES_A, "update_lead_details", { p_request_id: randomUUID(), p_lead_id: leadA, p_expected_version: lead.version, p_patch: { guest_range: "21-30" } }),
    ).rejects.toThrow(/changed by someone else/);
  });

  it("audit events cannot be modified even by the owner role", async () => {
    await expect(db.query(`update public.lead_events set event_type = 'x'`)).rejects.toThrow(/cannot be modified/);
    await expect(db.query(`delete from public.lead_events`)).rejects.toThrow(/cannot be modified/);
  });
});

describe("stages and closing", () => {
  it("requires a reason and explicit follow-up resolution to close as lost", async () => {
    const [lead] = await select<{ version: number }>(SALES_A, `select version from public.leads where id = $1`, [leadA]);
    await expect(
      rpc(SALES_A, "change_lead_stage", { p_request_id: randomUUID(), p_lead_id: leadA, p_expected_version: lead.version, p_stage: "lost" }),
    ).rejects.toThrow(/reason is required/);
    await expect(
      rpc(SALES_A, "change_lead_stage", { p_request_id: randomUUID(), p_lead_id: leadA, p_expected_version: lead.version, p_stage: "lost", p_reason: "Price too high" }),
    ).rejects.toThrow(/pending follow-up/);
    await rpc(SALES_A, "change_lead_stage", {
      p_request_id: randomUUID(), p_lead_id: leadA, p_expected_version: lead.version,
      p_stage: "lost", p_reason: "Price too high", p_pending_action: "cancel",
    });
    const pending = await select(SALES_A, `select 1 from public.follow_ups where lead_id = $1 and status = 'pending'`, [leadA]);
    expect(pending).toHaveLength(0);
    const [after] = await select<Row>(SALES_A, `select version, next_follow_up_at from public.leads where id = $1`, [leadA]);
    expect(after.next_follow_up_at).toBeNull();
    await rpc(SALES_A, "change_lead_stage", {
      p_request_id: randomUUID(), p_lead_id: leadA, p_expected_version: after.version, p_stage: "contacted", p_reason: "Customer called back",
    });
    const events = await select<Row>(SALES_A, `select event_type from public.lead_events where lead_id = $1 and event_type = 'lead_reopened'`, [leadA]);
    expect(events).toHaveLength(1);
  });
});

describe("assignment", () => {
  it("bulk reassignment moves pending work, keeps history, and flips access immediately", async () => {
    const lead = await createLead(SALES_A, "+919876500001", "Reassign Me");
    const fu = await rpc<{ id: string }>(SALES_A, "create_follow_up", {
      p_request_id: randomUUID(), p_lead_id: lead, p_due_at: new Date(Date.now() + 86400e3).toISOString(), p_purpose: "Send quote",
    });
    const done = await rpc<{ id: string }>(SALES_A, "create_follow_up", {
      p_request_id: randomUUID(), p_lead_id: lead, p_due_at: new Date(Date.now() + 3600e3).toISOString(), p_purpose: "Intro call",
    });
    await rpc(SALES_A, "complete_follow_up", { p_request_id: randomUUID(), p_follow_up_id: done.id, p_expected_version: 1, p_outcome: "Spoke" });

    const result = await rpc<Row>(MANAGER, "assign_leads", { p_request_id: randomUUID(), p_lead_ids: [lead, leadB], p_owner_id: SALES_C, p_reason: "Leave cover" });
    expect(result.updated).toBe(2);

    expect(await select(SALES_A, `select 1 from public.leads where id = $1`, [lead])).toHaveLength(0);
    expect(await select(SALES_C, `select 1 from public.leads where id = $1`, [lead])).toHaveLength(1);
    const [pending] = await select<Row>(SALES_C, `select assignee_id from public.follow_ups where id = $1`, [fu.id]);
    expect(pending.assignee_id).toBe(SALES_C);
    const [completed] = await select<Row>(SALES_C, `select completed_by, assignee_id from public.follow_ups where id = $1`, [done.id]);
    expect(completed.completed_by).toBe(SALES_A);
    const history = await select<Row>(SALES_C, `select previous_owner_id, new_owner_id, assigned_by from public.assignment_history where lead_id = $1 order by created_at desc limit 1`, [lead]);
    expect(history[0]).toMatchObject({ previous_owner_id: SALES_A, new_owner_id: SALES_C, assigned_by: MANAGER });
    const notes = await select<Row>(SALES_C, `select title from public.notifications`);
    expect(notes.some((n) => String(n.title).includes("2 leads assigned"))).toBe(true);
    // Salesperson B lost access to leadB as well.
    expect(await select(SALES_B, `select 1 from public.leads where id = $1`, [leadB])).toHaveLength(0);
  });
});

describe("deactivation and roles", () => {
  it("deactivated staff lose all data access", async () => {
    await rpc(ADMIN, "admin_update_staff", { p_request_id: randomUUID(), p_user_id: SALES_C, p_is_active: false });
    expect(await select(SALES_C, `select 1 from public.leads`)).toHaveLength(0);
    expect(await select(SALES_C, `select 1 from public.profiles`)).toHaveLength(0);
    await expect(rpc(SALES_C, "add_note", { p_request_id: randomUUID(), p_lead_id: leadB, p_body: "x" })).rejects.toThrow(/not active/);
    await rpc(ADMIN, "admin_update_staff", { p_request_id: randomUUID(), p_user_id: SALES_C, p_is_active: true });
  });

  it("protects the last active admin", async () => {
    await expect(
      rpc(ADMIN, "admin_update_staff", { p_request_id: randomUUID(), p_user_id: ADMIN, p_role: "manager" }),
    ).rejects.toThrow(/active admin/);
  });

  it("managers cannot change roles or settings", async () => {
    await expect(rpc(MANAGER, "admin_update_staff", { p_request_id: randomUUID(), p_user_id: SALES_A, p_role: "manager" })).rejects.toThrow(/Only an admin/);
    await expect(rpc(MANAGER, "update_business_settings", { p_patch: { business_name: "X" } })).rejects.toThrow(/Only an admin/);
  });
});

describe("imports", () => {
  function row(n: number, id: string | null, phone: string, extra: Record<string, unknown> = {}) {
    return {
      row_number: n,
      raw: { id, phone },
      normalized: {
        customer_name: `Lead ${n}`, phone_e164: phone, phone_raw: `p:${phone}`, external_lead_id: id,
        external_lead_id_raw: id, event_date_status: "missing", review_flags: ["event_details_missing"],
        source_created_at: "2026-10-01T10:00:00+05:30", platform: "ig", is_organic: false, source_status: "CREATED",
        ...extra,
      },
      status: "pending",
      decision: "import",
    };
  }

  async function runImport(rows: ReturnType<typeof row>[], owner: string | null = null) {
    const batch = await rpc<Row>(MANAGER, "import_create_batch", {
      p_client_token: randomUUID(),
      p_meta: { file_name: "leads.xlsx", total_rows: rows.length, default_owner_id: owner },
    });
    await rpc(MANAGER, "import_stage_rows", { p_batch_id: batch.id, p_rows: JSON.stringify(rows) });
    let progress: Row = {};
    do {
      progress = await rpc<Row>(MANAGER, "import_process_rows", { p_batch_id: batch.id, p_limit: 100 });
    } while ((progress.pending as number) > 0);
    return { batchId: batch.id as string, progress };
  }

  it("creates leads, preserves long IDs, and re-import creates nothing new", async () => {
    const rows = Array.from({ length: 250 }, (_, i) =>
      row(i + 2, `l:${(1234567890123456n + BigInt(i)).toString()}`, `+9198${String(10000000 + i).padStart(8, "0")}`));
    const first = await runImport(rows, SALES_A);
    expect(first.progress).toMatchObject({ created: 250, skipped: 0, failed: 0, status: "completed" });
    const [sample] = await select<Row>(MANAGER, `select external_lead_id, owner_id from public.leads where import_row_number = 2 and import_batch_id = $1`, [first.batchId]);
    expect(sample).toMatchObject({ external_lead_id: "l:1234567890123456", owner_id: SALES_A });

    const second = await runImport(rows);
    expect(second.progress).toMatchObject({ created: 0, skipped: 250, failed: 0 });
    const linked = await select<Row>(MANAGER, `select count(*)::int n from public.import_rows where batch_id = $1 and skip_reason = 'exact_duplicate' and lead_id is not null`, [second.batchId]);
    expect(linked[0].n).toBe(250);
  });

  it("keeps two genuine events for the same phone as separate leads", async () => {
    const res = await runImport([
      row(2, "l:900000000000001", "+919000000001", { event_date: "2026-11-02", event_date_status: "confirmed" }),
      row(3, "l:900000000000002", "+919000000001", { event_date: "2026-12-20", event_date_status: "confirmed" }),
    ]);
    expect(res.progress.created).toBe(2);
    const leads = await select(MANAGER, `select id from public.leads where phone_e164 = '+919000000001'`);
    expect(leads).toHaveLength(2);
  });

  it("dedupes rows without usable IDs by source fingerprint", async () => {
    const r = row(2, null, "+919000000077", { source_fingerprint: "meta|1.23457E+15|+919000000077|2026-10-01", external_id_damaged: true });
    expect((await runImport([r])).progress.created).toBe(1);
    expect((await runImport([r])).progress).toMatchObject({ created: 0, skipped: 1 });
  });

  it("records invalid rows and failed rows without aborting the batch, and retries safely", async () => {
    const bad = row(3, "l:777", "not-a-phone");
    const invalid = { ...row(4, "l:778", "+919000000078"), status: "invalid", normalized: null } as unknown as ReturnType<typeof row>;
    const res = await runImport([row(2, "l:776", "+919000000076"), bad, invalid]);
    expect(res.progress).toMatchObject({ created: 1, failed: 1, invalid: 1, status: "completed_with_issues" });
    const [{ total }] = await select<{ total: number }>(MANAGER,
      `select (created_count + skipped_count + invalid_count + failed_count) as total from public.import_batches where id = $1`, [res.batchId]);
    expect(total).toBe(3);
    await rpc(MANAGER, "import_retry_failed", { p_batch_id: res.batchId });
    const again = await rpc<Row>(MANAGER, "import_process_rows", { p_batch_id: res.batchId, p_limit: 100 });
    expect(again).toMatchObject({ created: 1, failed: 1, pending: 0 });
  });

  it("rejects more than 1,000 rows", async () => {
    await expect(
      rpc(MANAGER, "import_create_batch", { p_client_token: randomUUID(), p_meta: { file_name: "big.xlsx", total_rows: 1001 } }),
    ).rejects.toThrow(/limit is 1,000/);
  });

  it("is idempotent per client token", async () => {
    const token = randomUUID();
    const a = await rpc<Row>(MANAGER, "import_create_batch", { p_client_token: token, p_meta: { file_name: "a.csv", total_rows: 1 } });
    const b = await rpc<Row>(MANAGER, "import_create_batch", { p_client_token: token, p_meta: { file_name: "a.csv", total_rows: 1 } });
    expect(b.id).toBe(a.id);
    expect(b.existing).toBe(true);
  });

  it("salespeople cannot import", async () => {
    await expect(
      rpc(SALES_A, "import_create_batch", { p_client_token: randomUUID(), p_meta: { file_name: "x.csv", total_rows: 1 } }),
    ).rejects.toThrow(/Only an admin or manager/);
  });
});

describe("reports and reminders", () => {
  it("report cohort totals reconcile with search_leads", async () => {
    const filters = { acquired_from: "2026-09-01", acquired_to: "2026-12-31" };
    const report = await rpc<{ cohort: Row }>(MANAGER, "report_overview", { p_filters: filters });
    const [{ n }] = await select<{ n: number }>(MANAGER, `select count(*)::int n from public.search_leads($1)`, [JSON.stringify(filters)]);
    expect(report.cohort.total).toBe(n);
    const byStage = (report.cohort.by_stage as { leads: number }[]).reduce((s, r) => s + r.leads, 0);
    expect(byStage).toBe(n);
    const salesReport = await rpc<{ cohort: Row }>(SALES_A, "report_overview", { p_filters: {} });
    const [{ mine }] = await select<{ mine: number }>(SALES_A, `select count(*)::int mine from public.leads`);
    expect(salesReport.cohort.total).toBe(mine);
  });

  it("generates due and overdue reminders once", async () => {
    const lead = await createLead(SALES_B, "+919000000099", "Reminder Test");
    await rpc(SALES_B, "create_follow_up", {
      p_request_id: randomUUID(), p_lead_id: lead, p_due_at: new Date(Date.now() + 5 * 60e3).toISOString(), p_purpose: "Confirm menu",
    });
    const fu = await select<{ id: string }>(SALES_B, `select id from public.follow_ups where lead_id = $1`, [lead]);
    await db.query(`select private.generate_follow_up_reminders()`);
    await db.query(`select private.generate_follow_up_reminders()`);
    const due = await select(SALES_B, `select 1 from public.notifications where type = 'follow_up_due' and follow_up_id = $1`, [fu[0].id]);
    expect(due).toHaveLength(1);
    await db.query(`update public.follow_ups set due_at = now() - interval '1 minute' where id = $1`, [fu[0].id]);
    await db.query(`select private.generate_follow_up_reminders()`);
    await db.query(`select private.generate_follow_up_reminders()`);
    const overdue = await select(SALES_B, `select 1 from public.notifications where type = 'follow_up_overdue' and follow_up_id = $1`, [fu[0].id]);
    expect(overdue).toHaveLength(1);
    const visible = await select(SALES_B, `select id from public.search_leads($1)`, [JSON.stringify({ follow_up: "overdue" })]);
    expect(visible.map((r) => (r as Row).id)).toContain(lead);
  });
});

describe("deleting staff", () => {
  const SALES_D = "00000000-0000-4000-8000-0000000000d1";

  it("refuses while they still own open work", async () => {
    await createStaff(db, SALES_D, "salesperson", "Deepa");
    const lead = await createLead(SALES_D, "+919800000444", "Kiran");
    await rpc(SALES_D, "add_note", { p_request_id: randomUUID(), p_lead_id: lead, p_body: "Called, wants a quote" });
    await expect(rpc(ADMIN, "admin_delete_staff", { p_request_id: randomUUID(), p_user_id: SALES_D })).rejects.toThrow(
      /Reassign Deepa's 1 open lead/,
    );
    await rpc(ADMIN, "assign_leads", { p_request_id: randomUUID(), p_lead_ids: [lead], p_owner_id: SALES_A });
  });

  it("archives the member, keeps their history and frees the username", async () => {
    const requestId = randomUUID();
    const result = await rpc<{ email: string }>(ADMIN, "admin_delete_staff", { p_request_id: requestId, p_user_id: SALES_D });
    expect(result.email).toMatch(/^deleted-[0-9a-f]{24}@fcs-staff\.invalid$/);
    expect(await rpc(ADMIN, "admin_delete_staff", { p_request_id: requestId, p_user_id: SALES_D })).toMatchObject(result);

    const [profile] = await select<Row>(ADMIN, `select full_name, username, is_active, deleted_at from public.profiles where id = $1`, [SALES_D]);
    expect(profile).toMatchObject({ full_name: "Deepa", is_active: false });
    expect(profile?.deleted_at).not.toBeNull();
    expect(profile?.username).not.toBe("deepa");
    expect(await select(ADMIN, `select 1 from public.lead_notes where author_id = $1`, [SALES_D])).toHaveLength(1);
    expect(await select(SALES_D, `select 1 from public.leads`)).toHaveLength(0);

    await createStaff(db, "00000000-0000-4000-8000-0000000000d2", "salesperson", "Deepa");
  });

  it("only admins can delete, and never themselves", async () => {
    await expect(rpc(MANAGER, "admin_delete_staff", { p_request_id: randomUUID(), p_user_id: SALES_B })).rejects.toThrow(/Only an admin/);
    await expect(rpc(ADMIN, "admin_delete_staff", { p_request_id: randomUUID(), p_user_id: ADMIN })).rejects.toThrow(/your own account/);
  });
});
