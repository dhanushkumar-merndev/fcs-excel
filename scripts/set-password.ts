/**
 * Sets the password (and optionally the username) of an existing staff account. Use it when nobody
 * can sign in to reset it from Team.
 *   pnpm staff:password --target live --user <username or email> [--username new-name] [--password "…"]
 * Without --password a random one is generated. Prints the login details once.
 */
import { createClient } from "@supabase/supabase-js";
import { generatePassword, isValidUsername, MIN_PASSWORD, normalizeUsername, USERNAME_RULES } from "../src/lib/auth/username";
import { projectKeys } from "./supabase/keys";
import { parseTarget, projectRef } from "./supabase/mgmt";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const target = parseTarget(process.argv);
const who = arg("user")?.trim().toLowerCase();
const newUsername = arg("username") ? normalizeUsername(arg("username")!) : undefined;
const password = arg("password") ?? generatePassword();
if (!who) {
  console.error('Usage: pnpm staff:password --target live --user <username or email> [--username new-name] [--password "…"]');
  process.exit(1);
}
if (newUsername !== undefined && !isValidUsername(newUsername)) {
  console.error(`Username: ${USERNAME_RULES}`);
  process.exit(1);
}
if (password.length < MIN_PASSWORD) {
  console.error(`Use a password of at least ${MIN_PASSWORD} characters.`);
  process.exit(1);
}

const keys = await projectKeys(projectRef(target));
const admin = createClient(keys.url, keys.secret, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: profile, error } = await admin
  .from("profiles")
  .select("id, full_name, username, role, is_active")
  .eq(who.includes("@") ? "email" : "username", who)
  .maybeSingle();
if (error) throw new Error(error.message);
if (!profile) {
  console.error(`No staff member matches ${who}. Run bootstrap:admin, or add them from Team.`);
  process.exit(1);
}
if (!profile.is_active) {
  console.error(`@${profile.username} is deactivated. Reactivate them from Team first.`);
  process.exit(1);
}

let username = profile.username as string;
if (newUsername && newUsername !== username) {
  const { error: renameError } = await admin.from("profiles").update({ username: newUsername }).eq("id", profile.id);
  if (renameError) throw new Error(renameError.code === "23505" ? `@${newUsername} is already taken.` : renameError.message);
  username = newUsername;
}

const { error: updateError } = await admin.auth.admin.updateUserById(profile.id, { password, email_confirm: true });
if (updateError) throw new Error(updateError.message);

console.log(`\nLogin for ${profile.full_name} (${profile.role}) on ${target}:`);
console.log(`  Username: ${username}`);
console.log(`  Password: ${password}`);
