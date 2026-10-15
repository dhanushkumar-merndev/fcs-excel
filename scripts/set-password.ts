/**
 * Sets a password on an existing staff account and confirms its email. Use it when invite or reset
 * emails can't be delivered (Supabase's built-in email only reaches project members).
 * Prints the password once; change it after signing in (Forgot password).
 *   pnpm staff:password --target live --email you@example.com [--password "…"]
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { projectKeys } from "./supabase/keys";
import { parseTarget, projectRef } from "./supabase/mgmt";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const target = parseTarget(process.argv);
const email = arg("email")?.trim().toLowerCase();
if (!email) {
  console.error('Usage: pnpm staff:password --target live --email you@example.com [--password "…"]');
  process.exit(1);
}
const password = arg("password") ?? randomBytes(12).toString("base64url");
if (password.length < 10) {
  console.error("Use a password of at least 10 characters.");
  process.exit(1);
}

const keys = await projectKeys(projectRef(target));
const admin = createClient(keys.url, keys.secret, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: profile, error } = await admin
  .from("profiles")
  .select("id, full_name, role, is_active")
  .eq("email", email)
  .maybeSingle();
if (error) throw new Error(error.message);
if (!profile) {
  console.error(`${email} isn't a staff member. Run bootstrap:admin, or invite them from Team.`);
  process.exit(1);
}
if (!profile.is_active) {
  console.error(`${email} is deactivated. Reactivate them from Team first.`);
  process.exit(1);
}

const { error: updateError } = await admin.auth.admin.updateUserById(profile.id, { password, email_confirm: true });
if (updateError) throw new Error(updateError.message);

console.log(`\nPassword set for ${profile.full_name} (${profile.role}) on ${target}.`);
console.log(`  Email:    ${email}`);
console.log(`  Password: ${password}`);
console.log("\nSign in, then change it from Forgot password if this was shared.");
