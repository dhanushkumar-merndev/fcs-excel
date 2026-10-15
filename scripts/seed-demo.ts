/**
 * Demo data for the STAGING project only: demo staff + ~300 leads imported through the real
 * pipeline, then calls, follow-ups and stage changes performed as each salesperson via the RPCs.
 * Credentials are written to .env.demo.local (git-ignored). Refuses to run against live.
 *   pnpm seed:demo
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { RawRow } from "../src/lib/import/cells";
import { buildStagedRows, normalizeAll, prepareImport } from "../src/lib/import/prepare";
import { autoMapHeaders } from "../src/lib/import/template";
import { HEADERS, row } from "./fixtures/rows";
import { loadToolEnv, upsertEnvFile } from "./supabase/env";
import { projectKeys } from "./supabase/keys";
import { projectRef, query } from "./supabase/mgmt";

const env = loadToolEnv();
const ref = projectRef("staging");
if (!env.SUPABASE_STAGING_PROJECT_REF || ref === env.SUPABASE_PROJECT_REF) {
  console.error("Refusing to seed: the staging ref is missing or equals the live project.");
  process.exit(1);
}

const keys = await projectKeys(ref);
const admin = createClient(keys.url, keys.secret, { auth: { persistSession: false, autoRefreshToken: false } });

const STAFF = [
  { key: "ADMIN", name: "Demo Admin", role: "admin" },
  { key: "MANAGER", name: "Demo Manager", role: "manager" },
  { key: "SALES_A", name: "Anil (Demo)", role: "salesperson" },
  { key: "SALES_B", name: "Bina (Demo)", role: "salesperson" },
  { key: "SALES_C", name: "Chirag (Demo)", role: "salesperson" },
  { key: "SALES_D", name: "Divya (Demo)", role: "salesperson" },
] as const;

const ids: Record<string, string> = {};
const creds: Record<string, string> = {};
for (const s of STAFF) {
  const email = `demo.${s.key.toLowerCase().replace("_", ".")}@example.com`;
  const password = env[`DEMO_${s.key}_PASSWORD`] || randomBytes(12).toString("base64url");
  const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) {
    ids[s.key] = existing.id;
    await admin.auth.admin.updateUserById(existing.id, { password });
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
    ids[s.key] = data.user.id;
    const { error: pErr } = await admin.from("profiles").insert({ id: data.user.id, full_name: s.name, email, role: s.role });
    if (pErr) throw new Error(`profile ${email}: ${pErr.message}`);
  }
  creds[`DEMO_${s.key}_EMAIL`] = email;
  creds[`DEMO_${s.key}_PASSWORD`] = password;
}
upsertEnvFile(".env.demo.local", creds);
console.log("Demo staff ready (credentials in .env.demo.local).");

const dq = (text: string) => {
  let tag = "seed";
  while (text.includes(`$${tag}$`)) tag += "x";
  return `$${tag}$${text}$${tag}$`;
};
const asUser = (userId: string, sql: string) =>
  query(ref, `begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${userId}', true); ${sql}; commit;`);

// 1) Import ~300 demo leads through the real pipeline, as the manager.
const { count } = await admin.from("leads").select("id", { count: "exact", head: true });
if ((count ?? 0) < 50) {
  const rows: RawRow[] = Array.from({ length: 300 }, (_, i) => {
    const values = row(20000 + i, { idBase: 5550000000000000n });
    return { rowNumber: i + 2, cells: Object.fromEntries(HEADERS.map((h, idx) => [h, { t: "s" as const, v: String(values[idx]) }])) };
  });
  const mapping = autoMapHeaders(HEADERS);
  const normalized = normalizeAll(rows, mapping, { mode: "after_created" });
  const plan = prepareImport(normalized, [], {});
  const staged = buildStagedRows(plan);
  const token = randomUUID();
  await asUser(
    ids.MANAGER,
    `select public.import_create_batch('${token}', ${dq(JSON.stringify({ file_name: "demo-meta-leads.xlsx", total_rows: staged.length }))}::jsonb)`,
  );
  const [{ id: batchId }] = await query<{ id: string }>(ref, `select id from public.import_batches where client_token = '${token}'`);
  await asUser(ids.MANAGER, `select public.import_stage_rows('${batchId}', ${dq(JSON.stringify(staged))}::jsonb)`);
  for (let i = 0; i < 10; i++) await asUser(ids.MANAGER, `select public.import_process_rows('${batchId}', 100)`);
  console.log("Imported demo leads.");

  // 2) Assign: most leads to the four salespeople, some left unassigned.
  const leadIds = (await query<{ id: string }>(ref, `select id from public.leads where import_batch_id = '${batchId}' order by import_row_number`)).map((r) => r.id);
  const sales = ["SALES_A", "SALES_B", "SALES_C", "SALES_D"];
  const chunks: Record<string, string[]> = { SALES_A: [], SALES_B: [], SALES_C: [], SALES_D: [] };
  leadIds.slice(0, 260).forEach((id, i) => chunks[sales[i % 4]].push(id));
  for (const s of sales) {
    await asUser(ids.MANAGER, `select public.assign_leads('${randomUUID()}', array[${chunks[s].map((id) => `'${id}'`).join(",")}]::uuid[], '${ids[s]}', 'Demo distribution')`);
  }

  // 3) Work the leads as each salesperson: calls, notes, follow-ups, stages.
  const outcomes = ["connected", "no_answer", "busy", "callback_requested", "switched_off"];
  for (const s of sales) {
    const statements: string[] = [];
    chunks[s].forEach((id, i) => {
      if (i % 5 === 4) return; // some stay untouched (awaiting first call)
      const outcome = outcomes[i % outcomes.length];
      const stage = outcome === "connected" ? (i % 3 === 0 ? "qualified" : "contacted") : "contact_attempted";
      const due = new Date(Date.now() + ((i % 7) - 1) * 6 * 3600e3 + 3600e3).toISOString();
      statements.push(
        `select public.log_call('${randomUUID()}', '${id}', '${outcome}', ${dq(outcome === "connected" ? "Discussed menu and guest count. Wants a quote." : "No response, will retry.")}, ${dq(JSON.stringify({ due_at: due, purpose: outcome === "connected" ? "Send quote" : "Call again" }))}::jsonb, '${stage}')`,
      );
    });
    await asUser(ids[s], statements.join("; "));
  }

  // Close some leads (booked / lost) with reasons, keeping or cancelling pending work as the UI does.
  for (const s of sales) {
    const toBook = chunks[s].filter((_, i) => i % 9 === 0).slice(0, 4);
    const toLose = chunks[s].filter((_, i) => i % 11 === 1).slice(0, 3);
    const stmts = [
      ...toBook.map((id) => `select public.change_lead_stage('${randomUUID()}', '${id}', null, 'booked', null, 'keep')`),
      ...toLose.map((id) => `select public.change_lead_stage('${randomUUID()}', '${id}', null, 'lost', 'Price too high', 'cancel')`),
    ];
    if (stmts.length) await asUser(ids[s], stmts.join("; "));
  }

  // Demo only: push a few follow-ups into the past so overdue views have content.
  await query(ref, `update public.follow_ups set due_at = now() - interval '5 hours' where id in (select id from public.follow_ups where status = 'pending' order by random() limit 25)`);
  await query(ref, `select private.generate_follow_up_reminders()`);
  console.log("Demo activity recorded.");
} else {
  console.log("Leads already present — skipped demo import.");
}
console.log("Done.");
