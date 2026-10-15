/**
 * Creates the first admin (invite-only systems need one). Prints a one-time link to set a password.
 *   pnpm bootstrap:admin --target live --email you@example.com --name "Your Name" [--site-url https://crm.example.com]
 */
import { createClient } from "@supabase/supabase-js";
import { projectKeys } from "./supabase/keys";
import { parseTarget, projectRef } from "./supabase/mgmt";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const target = parseTarget(process.argv);
const email = arg("email")?.trim().toLowerCase();
const name = arg("name")?.trim();
const siteUrl = (arg("site-url") ?? "http://localhost:3000").replace(/\/$/, "");
if (!email || !name) {
  console.error('Usage: pnpm bootstrap:admin --target live --email you@example.com --name "Your Name"');
  process.exit(1);
}

const keys = await projectKeys(projectRef(target));
const admin = createClient(keys.url, keys.secret, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: existing } = await admin.from("profiles").select("id, role, is_active").ilike("email", email).maybeSingle();
if (existing) {
  console.log(`${email} is already a ${existing.role}${existing.is_active ? "" : " (inactive)"}. Nothing to do.`);
  process.exit(0);
}

let type: "invite" | "recovery" = "invite";
let link = await admin.auth.admin.generateLink({ type: "invite", email });
if (link.error) {
  type = "recovery";
  link = await admin.auth.admin.generateLink({ type: "recovery", email });
}
if (link.error || !link.data.user) throw new Error(link.error?.message ?? "Couldn't create the admin user.");

const { error } = await admin.from("profiles").insert({ id: link.data.user.id, full_name: name, email, role: "admin" });
if (error) throw new Error(`Profile insert failed: ${error.message}`);
await admin.from("audit_log").insert({ action: "admin_bootstrapped", entity_type: "profile", entity_id: link.data.user.id, payload: { email } });

console.log(`Admin ${name} <${email}> created on ${target}.`);
console.log(`Open this link once to set a password:\n${siteUrl}/auth/confirm?token_hash=${encodeURIComponent(link.data.properties.hashed_token)}&type=${type}`);
