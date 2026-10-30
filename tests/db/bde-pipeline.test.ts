/**
 * BDE pipeline: four desks, each its own salespeople. A lead is called by BDE 1, pushed to BDE 2
 * when interested, to BDE 3 when qualified, and reaches BDE 4 when the booking is confirmed with an
 * advance. Nothing changes until an admin switches the pipeline on.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, asUser, createDb, createStaff, type Db } from "./pglite";

const ADMIN = "00000000-0000-4000-8000-00000000000a";
const MANAGER = "00000000-0000-4000-8000-00000000000b";
const BDE1 = "00000000-0000-4000-8000-0000000000a1";
const BDE1B = "00000000-0000-4000-8000-0000000000a2";
const BDE2 = "00000000-0000-4000-8000-0000000000b1";
const BDE3 = "00000000-0000-4000-8000-0000000000c1";
const BDE4 = "00000000-0000-4000-8000-0000000000d1";

let db: Db;
let phone = 9100000000;
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

const lead = async (id: string) => (await db.query<Row>(`select * from public.leads where id = $1`, [id])).rows[0];

async function newLead(extra: Row = {}) {
  const res = await rpc<{ id: string }>(MANAGER, "create_lead", {
    p_request_id: randomUUID(),
    p_lead: { customer_name: "Customer", phone_e164: `+91${phone++}`, assign: "round_robin", ...extra },
  });
  return res.id;
}

async function staff(id: string, name: string, minutes: number, role: "salesperson" | "manager" | "admin" = "salesperson") {
  await createStaff(db, id, role, name);
  await db.query(`update public.profiles set created_at = now() + make_interval(mins => $2) where id = $1`, [id, minutes]);
}

async function turnOn(desks: Record<string, string | null> = { [BDE1]: "lead_desk", [BDE2]: "qualification", [BDE3]: "closing", [BDE4]: "operations" }) {
  return rpc(ADMIN, "update_pipeline", { p_enabled: true, p_desks: desks });
}

async function call(user: string, id: string, outcome = "connected") {
  return rpc(user, "log_call", { p_request_id: randomUUID(), p_lead_id: id, p_outcome: outcome });
}

async function handoff(user: string, id: string, to: string, note: string | null = "Wants a chef for 20 on Saturday", owner: string | null = null) {
  const l = await lead(id);
  return rpc<Row>(user, "handoff_lead", {
    p_request_id: randomUUID(),
    p_lead_id: id,
    p_expected_version: l.version,
    p_to_phase: to,
    p_note: note,
    p_owner_id: owner,
  });
}

async function qualifyDetails(user: string, id: string, patch: Row = {}) {
  const l = await lead(id);
  return rpc(user, "update_lead_details", {
    p_request_id: randomUUID(),
    p_lead_id: id,
    p_expected_version: l.version,
    p_patch: {
      occasion_code: "birthday",
      event_date: "2026-12-12",
      event_address: "Indiranagar, Bengaluru",
      guest_range: "10-25",
      service_type: "chef_on_demand",
      budget_inr: 3000,
      ...patch,
    },
  });
}

async function pay(user: string, id: string, kind: string, amount: number) {
  return rpc<Row>(user, "record_payment", {
    p_request_id: randomUUID(),
    p_lead_id: id,
    p_kind: kind,
    p_amount: amount,
    p_paid_on: "2026-11-01",
    p_mode: "upi",
  });
}

async function confirm(user: string, id: string, value = 2500) {
  const l = await lead(id);
  return rpc<Row>(user, "confirm_booking", { p_request_id: randomUUID(), p_lead_id: id, p_expected_version: l.version, p_booking_value: value });
}

async function ops(user: string, id: string, action: string, payload: Row = {}) {
  const l = await lead(id);
  return rpc<Row>(user, "ops_update", { p_request_id: randomUUID(), p_lead_id: id, p_expected_version: l.version, p_action: action, p_payload: payload });
}

async function stage(user: string, id: string, to: string, reason: string | null = null) {
  const l = await lead(id);
  return rpc<Row>(user, "change_lead_stage", {
    p_request_id: randomUUID(),
    p_lead_id: id,
    p_expected_version: l.version,
    p_stage: to,
    p_reason: reason,
    p_pending_action: "cancel",
  });
}

/** Walks a lead from creation to an operations booking. */
async function toBooking() {
  const id = await newLead();
  await call(BDE1, id);
  await handoff(BDE1, id, "qualification");
  await qualifyDetails(BDE2, id);
  await handoff(BDE2, id, "closing", "Confirmed 20 guests, budget ₹3,000");
  await pay(BDE3, id, "advance", 1000);
  await confirm(BDE3, id);
  return id;
}

beforeEach(async () => {
  db = await createDb();
  await staff(ADMIN, "Asha", 0, "admin");
  await staff(MANAGER, "Manoj", 0, "manager");
  await staff(BDE1, "Anil", 1);
  await staff(BDE2, "Bina", 2);
  await staff(BDE3, "Chirag", 3);
  await staff(BDE4, "Divya", 4);
});

describe("BDE pipeline: switched off", () => {
  it("changes nothing: round robin covers every salesperson and stages move freely", async () => {
    const owners = [];
    for (let i = 0; i < 4; i++) owners.push((await lead(await newLead())).owner_id);
    expect(owners).toEqual([BDE1, BDE2, BDE3, BDE4]);

    const id = await newLead();
    await stage(BDE1, id, "qualified");
    expect(await lead(id)).toMatchObject({ stage: "qualified", phase: "closing" }); // desk follows the stage
    await expect(handoff(BDE1, id, "operations")).rejects.toThrow(/switched off/);
  });

  it("fills in the service from the sheet tab or form name, never overwriting one that's set", async () => {
    const insert = async (form: string | null, service: string | null = null) =>
      (
        await db.query<{ service_type: string | null }>(
          `insert into public.leads (customer_name, phone_e164, form_name, service_type) values ('X', $1, $2, $3) returning service_type`,
          [`+91${phone++}`, form, service],
        )
      ).rows[0].service_type;
    expect(await insert("Chef at home booking form")).toBe("chef_on_demand");
    expect(await insert("Catering enquiry form")).toBe("catering");
    expect(await insert("Chef & catering form")).toBeNull();
    expect(await insert("Party form")).toBeNull();
    expect(await insert("Catering enquiry form", "chef_on_demand")).toBe("chef_on_demand");
  });

  it("can't be switched on until every desk has someone", async () => {
    await expect(rpc(MANAGER, "update_pipeline", { p_enabled: true, p_desks: {} })).rejects.toThrow(/Only an admin/);
    await expect(turnOn({ [BDE1]: "lead_desk", [BDE2]: "qualification" })).rejects.toThrow(/Missing: BDE 3 \(closing\), BDE 4 \(operations\)/);
    await expect(turnOn({ [MANAGER]: "lead_desk" })).rejects.toThrow(/Only salespeople/);
    expect((await db.query(`select pipeline_enabled from public.business_settings`)).rows[0]).toEqual({ pipeline_enabled: false });
  });
});

describe("BDE pipeline: switched on", () => {
  beforeEach(async () => {
    await turnOn();
  });

  it("deals new leads only to the BDE 1 desk, in turn", async () => {
    await staff(BDE1B, "Arjun", 5);
    await rpc(ADMIN, "update_pipeline", { p_enabled: true, p_desks: { [BDE1B]: "lead_desk" } });
    const owners = [];
    for (let i = 0; i < 4; i++) owners.push((await lead(await newLead())).owner_id);
    expect(owners).toEqual([BDE1, BDE1B, BDE1, BDE1B]);
  });

  it("walks a lead through all four desks, each handoff going to that desk's person", async () => {
    const id = await newLead();
    expect(await lead(id)).toMatchObject({ phase: "lead_desk", owner_id: BDE1, stage: "new" });

    await expect(handoff(BDE1, id, "qualification")).rejects.toThrow(/Log a connected call/);
    await call(BDE1, id, "no_answer");
    await expect(handoff(BDE1, id, "qualification")).rejects.toThrow(/Log a connected call/);
    await call(BDE1, id);
    await expect(handoff(BDE1, id, "qualification", "  ")).rejects.toThrow(/Add a note/);
    const pushed = await handoff(BDE1, id, "qualification");
    expect(pushed).toMatchObject({ phase: "qualification", stage: "interested", owner_id: BDE2, owner_name: "Bina" });

    // BDE 1 no longer has the lead.
    await expect(handoff(BDE1, id, "closing")).rejects.toThrow(/not found or you do not have access/);

    await expect(handoff(BDE2, id, "closing")).rejects.toThrow(/Fill in before qualifying: event type, event date, location, guest count, service, budget/);
    await qualifyDetails(BDE2, id, { budget_inr: null });
    await expect(handoff(BDE2, id, "closing")).rejects.toThrow(/Fill in before qualifying: budget\./);
    await qualifyDetails(BDE2, id);
    expect(await handoff(BDE2, id, "closing")).toMatchObject({ phase: "closing", stage: "qualified", owner_id: BDE3 });

    await stage(BDE3, id, "quote_sent");
    await expect(stage(BDE3, id, "booked")).rejects.toThrow(/Use Confirm booking/);
    await expect(confirm(BDE3, id)).rejects.toThrow(/Record the advance payment first/);
    await pay(BDE3, id, "advance", 1000);
    const booked = await confirm(BDE3, id, 2500);
    expect(booked).toMatchObject({ stage: "booked", phase: "operations", owner_id: BDE4, handed_to_operations: true });
    expect(await lead(id)).toMatchObject({ booking_value_inr: "2500.00", quoted_amount_inr: "2500.00" });

    await expect(ops(BDE4, id, "complete")).rejects.toThrow(/Assign the chef/);
    await ops(BDE4, id, "acknowledge");
    await ops(BDE4, id, "chef", { chef_name: "Chef Ravi", chef_phone: "+919800000000" });
    await ops(BDE4, id, "complete", { note: "Went well" });
    const done = await lead(id);
    expect(done.handover_acknowledged_by).toBe(BDE4);
    expect(done.chef_name).toBe("Chef Ravi");
    expect(done.event_completed_at).not.toBeNull();

    const handoffs = (await db.query(`select from_phase, to_phase, from_owner_id, to_owner_id from public.lead_handoffs where lead_id = $1 order by created_at, id`, [id])).rows;
    expect(handoffs).toEqual([
      { from_phase: "lead_desk", to_phase: "qualification", from_owner_id: BDE1, to_owner_id: BDE2 },
      { from_phase: "qualification", to_phase: "closing", from_owner_id: BDE2, to_owner_id: BDE3 },
      { from_phase: "closing", to_phase: "operations", from_owner_id: BDE3, to_owner_id: BDE4 },
    ]);
    const notified = (await db.query<{ recipient_id: string }>(`select recipient_id from public.notifications where lead_id = $1 and title like 'Lead handed to you%' order by created_at`, [id])).rows;
    expect(notified.map((n) => n.recipient_id).sort()).toEqual([BDE2, BDE3, BDE4].sort());
  });

  it("keeps each desk to its own stages, and salespeople can't skip a desk", async () => {
    const id = await newLead();
    await expect(stage(BDE1, id, "quote_sent")).rejects.toThrow(/with BDE 1 \(lead desk\), where it can't be marked quote sent/);
    await call(BDE1, id);
    await expect(handoff(BDE1, id, "closing")).rejects.toThrow(/only hand a lead on to the next desk/);
    await expect(handoff(BDE1, id, "operations")).rejects.toThrow(/reach BDE 4 by confirming/);

    // A manager can move a lead to any desk (requirements still apply going forward) and choose who.
    await qualifyDetails(MANAGER, id);
    expect(await handoff(MANAGER, id, "closing", "Manager fast-track", BDE3)).toMatchObject({ phase: "closing", owner_id: BDE3 });
    await expect(handoff(BDE3, id, "lead_desk", "Back", BDE1)).rejects.toThrow(/only hand a lead on to the next desk/);
    expect(await handoff(MANAGER, id, "lead_desk", "Back to calling")).toMatchObject({ phase: "lead_desk", stage: "contacted", owner_id: BDE1 });
  });

  it("can lose a lead at any desk, and records which desk", async () => {
    const atDesk1 = await newLead();
    await stage(BDE1, atDesk1, "unqualified", "Not interested");
    const at3 = await newLead();
    await call(BDE1, at3);
    await handoff(BDE1, at3, "qualification");
    await qualifyDetails(BDE2, at3);
    await handoff(BDE2, at3, "closing");
    await stage(BDE3, at3, "lost", "Price too high");
    const cancelled = await toBooking();
    await stage(BDE4, cancelled, "lost", "Booking cancelled");

    expect(await lead(atDesk1)).toMatchObject({ stage: "unqualified", phase: "lead_desk" });
    expect(await lead(at3)).toMatchObject({ stage: "lost", phase: "closing" });
    expect(await lead(cancelled)).toMatchObject({ stage: "lost", phase: "operations" });
    await expect(handoff(BDE3, at3, "operations")).rejects.toThrow(/This lead is closed/);
  });

  it("keeps an append-only payment ledger and refuses refunds beyond what was paid", async () => {
    const id = await toBooking();
    await pay(BDE4, id, "balance", 1500);
    await expect(pay(BDE4, id, "refund", 2600)).rejects.toThrow(/can't be more than what has been paid/);
    const res = await pay(BDE4, id, "refund", 500);
    expect(Number(res.paid_total)).toBe(2000);
    await expect(db.query(`update public.lead_payments set amount_inr = 1`)).rejects.toThrow(/cannot be modified/);
    await expect(pay(BDE4, id, "advance", -5)).rejects.toThrow(/above zero/);
    await expect(rpc(BDE1, "record_payment", { p_request_id: randomUUID(), p_lead_id: id, p_kind: "advance", p_amount: 1, p_paid_on: "2026-11-01" })).rejects.toThrow(
      /not found or you do not have access/,
    );
  });

  it("still books when nobody is on BDE 4, leaving the booking with BDE 3", async () => {
    await db.query(`update public.profiles set in_round_robin = false where id = $1`, [BDE4]);
    const id = await newLead();
    await call(BDE1, id);
    await handoff(BDE1, id, "qualification");
    await qualifyDetails(BDE2, id);
    await handoff(BDE2, id, "closing");
    await pay(BDE3, id, "advance", 500);
    expect(await confirm(BDE3, id)).toMatchObject({ stage: "booked", phase: "operations", owner_id: BDE3, handed_to_operations: false });
  });

  it("deals selected leads round robin within each lead's own desk", async () => {
    const a = await newLead();
    await call(BDE1, a);
    await handoff(BDE1, a, "qualification");
    await db.query(`update public.leads set owner_id = null where id = $1`, [a]);
    const res = await rpc<Row>(MANAGER, "assign_leads_round_robin", { p_request_id: randomUUID(), p_lead_ids: [a] });
    expect(res.updated).toBe(1);
    expect((await lead(a)).owner_id).toBe(BDE2);
  });
});

describe("BDE pipeline: KPIs", () => {
  it("counts each desk's flow and scopes salespeople to their own numbers", async () => {
    await turnOn();
    const booked = await toBooking();
    await ops(BDE4, booked, "acknowledge");
    const lost1 = await newLead();
    await stage(BDE1, lost1, "unqualified", "Not interested");
    const waiting = await newLead();
    await call(BDE1, waiting);
    await handoff(BDE1, waiting, "qualification");

    const today = (await db.query<{ d: string }>(`select to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') d`)).rows[0].d;
    type K = { desks: { desk: string; metric: string; leads: number }[]; bookings: Row; payments: Row; outstanding: string | number; hygiene: Row; scope: string };
    const team = await rpc<K>(MANAGER, "pipeline_kpis", { p_from: today, p_to: today });
    const m = (desk: string, metric: string) => team.desks.find((d) => d.desk === desk && d.metric === metric)?.leads ?? 0;

    expect([m("lead_desk", "received"), m("lead_desk", "attended"), m("lead_desk", "pushed"), m("lead_desk", "lost")]).toEqual([3, 2, 2, 1]);
    expect([m("qualification", "received"), m("qualification", "pushed"), m("qualification", "open")]).toEqual([2, 1, 1]);
    expect([m("closing", "received"), m("closing", "pushed")]).toEqual([1, 1]);
    expect([m("operations", "received"), m("operations", "acknowledged"), m("operations", "open")]).toEqual([1, 1, 1]);
    expect(team.bookings).toMatchObject({ count: 1, gross: 2500 });
    expect(team.payments).toMatchObject({ advance: 0, balance: 0, refund: 0 }); // paid_on is 1 Nov, outside today
    expect(Number(team.outstanding)).toBe(1500);
    expect(team.scope).toBe("team");

    const mine = await rpc<K>(BDE2, "pipeline_kpis", { p_from: today, p_to: today });
    expect(mine.scope).toBe("me");
    expect(mine.desks.every((d) => d.desk === "qualification" || d.metric === "open" || d.desk === "operations")).toBe(true);
    expect(mine.desks.find((d) => d.desk === "qualification" && d.metric === "received")?.leads).toBe(2);
    expect(mine.desks.find((d) => d.desk === "lead_desk")).toBeUndefined();
  });
});

describe("BDE pipeline: migration on existing data", () => {
  it("puts existing leads on the desk their stage belongs to, without touching owners or updated_at", async () => {
    const fresh = await createDb({ stopBefore: "20261105100000" });
    const prev = db;
    db = fresh;
    try {
      await staff(ADMIN, "Asha", 0, "admin");
      await staff(MANAGER, "Manoj", 0, "manager");
      await staff(BDE1, "Anil", 1);
      const ids: Record<string, string> = {};
      for (const s of ["new", "contacted", "quote_sent", "booked", "lost"]) {
        const res = await rpc<{ id: string }>(MANAGER, "create_lead", {
          p_request_id: randomUUID(),
          p_lead: { customer_name: s, phone_e164: `+91${phone++}`, owner_id: BDE1 },
        });
        ids[s] = res.id;
        await db.query(`update public.leads set stage = $2, closed_reason = case when $2 = 'lost' then 'Other' end where id = $1`, [res.id, s]);
      }
      const before = (await db.query(`select id, updated_at from public.leads order by id`)).rows;
      await applyMigrations(db, (name) => name >= "20261105100000");
      const phases = Object.fromEntries(
        await Promise.all(Object.entries(ids).map(async ([s, id]) => [s, (await lead(id)).phase] as const)),
      );
      expect(phases).toEqual({ new: "lead_desk", contacted: "lead_desk", quote_sent: "closing", booked: "operations", lost: "lead_desk" });
      expect((await db.query(`select id, updated_at from public.leads order by id`)).rows).toEqual(before);
      expect((await db.query(`select distinct owner_id from public.leads`)).rows).toEqual([{ owner_id: BDE1 }]);
      const reasons = (await db.query<{ unqualified_reasons: string[] }>(`select unqualified_reasons from public.business_settings`)).rows[0].unqualified_reasons;
      expect(reasons.at(-1)).toBe("Other");
      expect(reasons).toContain("Not interested");
      expect(reasons.filter((r) => r === "Duplicate enquiry")).toHaveLength(1);
    } finally {
      db = prev;
    }
  });
});
