/**
 * Creates the first admin (everyone else is added from Team). Username + password; nothing is emailed.
 *   pnpm bootstrap:admin --target live --username owner --name "Your Name" [--password "…"]
 * Without --password a random one is generated and printed once.
 */
import { createClient } from "@supabase/supabase-js";
import { generatePassword, isValidUsername, loginEmailFor, MIN_PASSWORD, normalizeUsername, USERNAME_RULES } from "../src/lib/auth/username";
import { projectKeys } from "./supabase/keys";
import { parseTarget, projectRef } from "./supabase/mgmt";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const target = parseTarget(process.argv);
const username = normalizeUsername(arg("username") ?? "");
const name = arg("name")?.trim();
const password = arg("password") ?? generatePassword();
if (!username || !name) {
  console.error('Usage: pnpm bootstrap:admin --target live --username owner --name "Your Name" [--password "…"]');
  process.exit(1);
}
if (!isValidUsername(username)) {
  console.error(`Username: ${USERNAME_RULES}`);
  process.exit(1);
}
if (password.length < MIN_PASSWORD) {
  console.error(`Use a password of at least ${MIN_PASSWORD} characters.`);
  process.exit(1);
}

const keys = await projectKeys(projectRef(target));
const admin = createClient(keys.url, keys.secret, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: existing } = await admin.from("profiles").select("id, role, is_active").eq("username", username).maybeSingle();
if (existing) {
  console.log(`@${username} is already a ${existing.role}${existing.is_active ? "" : " (inactive)"}. Use pnpm staff:password to reset it.`);
  process.exit(0);
}

const email = loginEmailFor(username);
const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (error || !data.user) throw new Error(error?.message ?? "Couldn't create the admin user.");

const { error: profileError } = await admin.from("profiles").insert({ id: data.user.id, full_name: name, email, username, role: "admin" });
if (profileError) {
  await admin.auth.admin.deleteUser(data.user.id);
  throw new Error(`Profile insert failed: ${profileError.message}`);
}

console.log(`\nAdmin ${name} created on ${target}.`);
console.log(`  Username: ${username}`);
console.log(`  Password: ${password}`);
console.log("\nSign in, then add the rest of the team from Team.");
