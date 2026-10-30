/**
 * Round robin: leads go to salespeople in turn, a newcomer takes their turn from when they join,
 * and people left out (or deactivated) are skipped.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { asUser, createDb, createStaff, type Db } from "./pglite";

const ADMIN = "00000000-0000-4000-8000-00000000000a";
const MANAGER = "00000000-0000-4000-8000-00000000000b";
const SALES_A = "00000000-0000-4000-8000-0000000000a1";
const SALES_B = "00000000-0000-4000-8000-0000000000b1";
const SALES_C = "00000000-0000-4000-8000-0000000000c1";
const SALES_D = "00000000-0000-4000-8000-0000000000d1";

let db: Db;
let phone = 9000000000;

type Row = Record<string, unknown>;

async function rpc<T = Row>(user: string | null, fn: string, args: Record<string, unknown>): Promise<T> {
  const names = Object.keys(args);
  const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as result`;
  return asUser(db, user, async (tx) => {
    const res = await tx.query<{ result: T }>(
      sql,
      names.map((n) => (args[n] !== null && typeof args[n] === "object" && !Array.isArray(args[n]) ? JSON.stringify(args[n]) : args[n])),
    );
    return res.rows[0]?.result as T;
  });
}

async function newLead(owner: string | null = null, assign?: "round_robin") {
  const result = await rpc<{ id: string }>(ADMIN, "create_lead", {
    p_request_id: randomUUID(),
    p_lead: { customer_name: "Customer", phone_e164: `+91${phone++}`, owner_id: owner, ...(assign ? { assign } : {}) },
  });
  return result.id;
}

const ownerOf = async (id: string) => (await db.query<{ owner_id: string | null }>(`select owner_id from public.leads where id = $1`, [id])).rows[0].owner_id;

/** Owners of the leads created by `n` round-robin creations, in order. */
async function dealt(n: number) {
  const owners: (string | null)[] = [];
  for (let i = 0; i < n; i++) owners.push(await ownerOf(await newLead(null, "round_robin")));
  return owners;
}

async function joinLater(id: string, role: "salesperson" | "manager", name: string, minutesAfter: number) {
  await createStaff(db, id, role, name);
  await db.query(`update public.profiles set created_at = now() + make_interval(mins => $2) where id = $1`, [id, minutesAfter]);
}

beforeEach(async () => {
  db = await createDb();
  await createStaff(db, ADMIN, "admin", "Asha");
  await createStaff(db, MANAGER, "manager", "Manoj");
  await joinLater(SALES_A, "salesperson", "Anil", 1);
  await joinLater(SALES_B, "salesperson", "Bina", 2);
  await joinLater(SALES_C, "salesperson", "Chirag", 3);
});

describe("round robin", () => {
  it("deals salespeople in turn, in the order they joined, and never to admins or managers", async () => {
    expect(await rpc(MANAGER, "round_robin_next", {})).toBe(SALES_A);
    expect(await dealt(7)).toEqual([SALES_A, SALES_B, SALES_C, SALES_A, SALES_B, SALES_C, SALES_A]);
    expect(await rpc(MANAGER, "round_robin_next", {})).toBe(SALES_B);
  });

  it("a new salesperson takes their turn from now on, without catching up", async () => {
    expect(await dealt(4)).toEqual([SALES_A, SALES_B, SALES_C, SALES_A]);
    await joinLater(SALES_D, "salesperson", "Divya", 10);
    expect(await dealt(5)).toEqual([SALES_B, SALES_C, SALES_D, SALES_A, SALES_B]);
  });

  it("skips people left out or deactivated, and admins can switch it off", async () => {
    await expect(rpc(MANAGER, "update_round_robin", { p_enabled: true, p_excluded: [SALES_B] })).rejects.toThrow(/Only an admin/);
    await rpc(ADMIN, "update_round_robin", { p_enabled: true, p_excluded: [SALES_B] });
    await db.query(`update public.profiles set is_active = false where id = $1`, [SALES_C]);
    expect(await dealt(3)).toEqual([SALES_A, SALES_A, SALES_A]);

    await rpc(ADMIN, "update_round_robin", { p_enabled: false, p_excluded: [SALES_A, SALES_B] });
    expect((await db.query(`select round_robin_enabled from public.business_settings`)).rows[0]).toEqual({ round_robin_enabled: false });
    await expect(newLead(null, "round_robin")).rejects.toThrow(/Nobody is in the round robin/);
  });

  it("deals out waiting unassigned open leads in parts, evenly, and tells each person once", async () => {
    const waiting = [];
    for (let i = 0; i < 10; i++) waiting.push(await newLead());
    const lost = await newLead();
    await db.query(`update public.leads set stage = 'lost', closed_reason = 'Other' where id = $1`, [lost]);
    const owned = await newLead(SALES_C);

    await expect(rpc(SALES_A, "assign_leads_round_robin", { p_request_id: randomUUID() })).rejects.toThrow(/Only an admin or manager/);
    const first = await rpc<{ updated: number; remaining: number }>(MANAGER, "assign_leads_round_robin", { p_request_id: randomUUID(), p_limit: 6 });
    expect(first).toMatchObject({ updated: 6, remaining: 4 });
    const second = await rpc<{ updated: number; remaining: number; per_owner: { name: string; count: number }[] }>(MANAGER, "assign_leads_round_robin", {
      p_request_id: randomUUID(),
      p_limit: 6,
    });
    expect(second).toMatchObject({ updated: 4, remaining: 0 });

    const counts = (
      await db.query<{ owner_id: string; n: number }>(
        `select owner_id, count(*)::int n from public.leads where id = any ($1) group by owner_id order by owner_id`,
        [waiting],
      )
    ).rows;
    expect(counts.map((c) => c.n).sort()).toEqual([3, 3, 4]);
    expect(await ownerOf(lost)).toBeNull();
    expect(await ownerOf(owned)).toBe(SALES_C);

    const history = (await db.query<{ reason: string }>(`select reason from public.assignment_history where lead_id = $1`, [waiting[0]])).rows;
    expect(history).toEqual([{ reason: "Round robin" }]);
    const notes = (await db.query<{ recipient_id: string }>(`select recipient_id from public.notifications where type = 'lead_assigned' and body like 'Round robin%'`)).rows;
    expect(notes).toHaveLength(6); // three people, once per call
  });

  it("reassigns selected leads round robin, including ones that already had an owner", async () => {
    const a = await newLead(SALES_C);
    const b = await newLead();
    const res = await rpc<{ updated: number }>(MANAGER, "assign_leads_round_robin", { p_request_id: randomUUID(), p_lead_ids: [a, b] });
    expect(res.updated).toBe(2);
    expect([await ownerOf(a), await ownerOf(b)]).toEqual([SALES_A, SALES_B]);
    const away = (await db.query(`select recipient_id from public.notifications where type = 'lead_reassigned_away'`)).rows;
    expect(away).toEqual([{ recipient_id: SALES_C }]);
  });

  it("imports deal new leads in turn, and a skipped duplicate doesn't use up a turn", async () => {
    const row = (n: number, id: string) => ({
      row_number: n,
      raw: { id },
      normalized: { customer_name: `Lead ${n}`, phone_e164: `+91${phone++}`, external_lead_id: id, event_date_status: "missing" },
      status: "pending",
      decision: "import",
    });
    const run = async (rows: ReturnType<typeof row>[]) => {
      const batch = await rpc<Row>(MANAGER, "import_create_batch", {
        p_client_token: randomUUID(),
        p_meta: { file_name: "leads.xlsx", total_rows: rows.length, assign: "round_robin" },
      });
      await rpc(MANAGER, "import_stage_rows", { p_batch_id: batch.id, p_rows: JSON.stringify(rows) });
      await rpc(MANAGER, "import_process_rows", { p_batch_id: batch.id, p_limit: 100 });
      return batch.id as string;
    };
    await run([row(2, "l:1"), row(3, "l:2")]);
    const second = await run([row(2, "l:1"), row(3, "l:3"), row(4, "l:4")]);
    const owners = (
      await db.query<{ external_lead_id: string; owner_id: string }>(`select external_lead_id, owner_id from public.leads order by external_lead_id`)
    ).rows.map((r) => r.owner_id);
    expect(owners).toEqual([SALES_A, SALES_B, SALES_C, SALES_A]);
    const notes = (
      await db.query<{ recipient_id: string; title: string }>(
        `select recipient_id, title from public.notifications where import_batch_id = $1 and type = 'lead_assigned' order by recipient_id`,
        [second],
      )
    ).rows;
    expect(notes).toEqual([
      { recipient_id: SALES_A, title: "New lead assigned to you" },
      { recipient_id: SALES_C, title: "New lead assigned to you" },
    ]);
  });
});
