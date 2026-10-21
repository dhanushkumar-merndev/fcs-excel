"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { fromDbError, invalid, ok, type ActionResult } from "@/lib/action-result";
import { getStaffOrNull } from "@/lib/auth/dal";
import { loginEmailFor, MIN_PASSWORD, normalizeUsername, USERNAME_PATTERN, USERNAME_RULES } from "@/lib/auth/username";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const role = z.enum(["admin", "manager", "salesperson"]);

type Gate = { error: ActionResult<never> } | { staff: NonNullable<Awaited<ReturnType<typeof getStaffOrNull>>> };

async function requireAdmin(): Promise<Gate> {
  const staff = await getStaffOrNull();
  if (!staff) return { error: { ok: false, code: "unauthenticated", message: "Your session expired. Sign in again." } };
  if (staff.role !== "admin") return { error: { ok: false, code: "forbidden", message: "Only an admin can manage the team." } };
  return { staff };
}

const password = z
  .string()
  .min(MIN_PASSWORD, `Use a password of at least ${MIN_PASSWORD} characters.`)
  .max(72, "Use a password of at most 72 characters.");

const memberSchema = z.object({
  fullName: z.string().trim().min(1, "Enter their name.").max(120),
  username: z.string().transform(normalizeUsername).pipe(z.string().regex(USERNAME_PATTERN, `Username: ${USERNAME_RULES}`)),
  password,
  role,
});

/**
 * Admin-created logins: username + password, nothing emailed. Creates the auth user (confirmed,
 * on an internal address), then the profile with the chosen role — server-side, never from
 * user metadata. The admin hands the details over themselves.
 */
export async function addStaff(input: z.input<typeof memberSchema>): Promise<ActionResult<{ username: string }>> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Check the form.");
  const { fullName, username, password: newPassword, role: newRole } = parsed.data;
  const admin = createAdminClient();
  const taken = "That username is already taken. Try another.";

  const { data: existing } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (existing) return invalid(taken);

  const email = loginEmailFor(username);
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: newPassword, email_confirm: true });
  if (createError || !created.user) {
    const message = createError?.message ?? "";
    return invalid(/registered|exists/i.test(message) ? taken : /password/i.test(message) ? message : "Couldn't create the login. Try again.");
  }
  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    full_name: fullName,
    email,
    username,
    role: newRole,
    invited_by: gate.staff.id,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    if (profileError.code === "23505") return invalid(taken);
    return { ok: false, code: "unknown", message: "Couldn't create the team member. Nothing was saved — try again." };
  }
  await admin.from("audit_log").insert({
    actor_id: gate.staff.id,
    action: "staff_created",
    entity_type: "profile",
    entity_id: created.user.id,
    payload: { name: fullName, username, role: newRole },
  });
  refresh();
  return ok({ username });
}

/** Admin sets a new password for someone who forgot theirs. The password itself is never logged. */
export async function resetStaffPassword(input: { userId: string; password: string }): Promise<ActionResult<{ username: string }>> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;
  const parsed = z.object({ userId: z.string().uuid(), password }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Check the form.");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("username, is_active").eq("id", parsed.data.userId).maybeSingle();
  if (!profile) return invalid("Unknown team member.");
  if (!profile.is_active) return invalid("Reactivate this person before resetting their password.");
  const { error } = await admin.auth.admin.updateUserById(parsed.data.userId, { password: parsed.data.password, email_confirm: true });
  if (error) return invalid(/password/i.test(error.message) ? error.message : "Couldn't reset the password. Try again.");
  await admin.from("audit_log").insert({
    actor_id: gate.staff.id,
    action: "staff_password_reset",
    entity_type: "profile",
    entity_id: parsed.data.userId,
    payload: { username: profile.username },
  });
  return ok({ username: profile.username });
}

export async function changeRole(input: { requestId: string; userId: string; role: string }): Promise<ActionResult<{ role: string }>> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;
  const parsed = z.object({ requestId: z.string().uuid(), userId: z.string().uuid(), role }).safeParse(input);
  if (!parsed.success) return invalid("Invalid role change.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_update_staff", {
    p_request_id: parsed.data.requestId,
    p_user_id: parsed.data.userId,
    p_role: parsed.data.role,
    p_is_active: null,
  });
  if (error) return fromDbError(error);
  refresh();
  return ok(data as { role: string });
}

/**
 * Deactivation removes data access immediately (RLS treats inactive staff as nobody) and bans the
 * login so existing sessions can't refresh. Their past work keeps its attribution.
 */
export async function setActive(input: { requestId: string; userId: string; active: boolean }): Promise<ActionResult<{ active: boolean }>> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;
  const parsed = z.object({ requestId: z.string().uuid(), userId: z.string().uuid(), active: z.boolean() }).safeParse(input);
  if (!parsed.success) return invalid("Invalid request.");
  if (parsed.data.userId === gate.staff.id && !parsed.data.active) return invalid("You can't deactivate your own account.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_staff", {
    p_request_id: parsed.data.requestId,
    p_user_id: parsed.data.userId,
    p_role: null,
    p_is_active: parsed.data.active,
  });
  if (error) return fromDbError(error);
  const admin = createAdminClient();
  const { error: banError } = await admin.auth.admin.updateUserById(parsed.data.userId, {
    ban_duration: parsed.data.active ? "none" : "876000h",
  });
  refresh();
  if (banError) {
    return {
      ok: false,
      code: "unknown",
      message: parsed.data.active
        ? "Reactivated, but the login is still blocked. Try again."
        : "Data access was removed, but blocking the login failed. Try again to sign them out everywhere.",
    };
  }
  return ok({ active: parsed.data.active });
}

/**
 * Deleting archives the member: they leave the team and can't sign in, while their calls, notes
 * and lead history keep their name. The username and login address are released for reuse.
 */
export async function deleteStaff(input: { requestId: string; userId: string }): Promise<ActionResult<null>> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;
  const parsed = z.object({ requestId: z.string().uuid(), userId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return invalid("Invalid request.");
  if (parsed.data.userId === gate.staff.id) return invalid("You can't delete your own account.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_delete_staff", {
    p_request_id: parsed.data.requestId,
    p_user_id: parsed.data.userId,
  });
  if (error) return fromDbError(error);
  const { email } = data as { email: string };
  const { error: authError } = await createAdminClient().auth.admin.updateUserById(parsed.data.userId, {
    email,
    email_confirm: true,
    ban_duration: "876000h",
  });
  refresh();
  if (authError) {
    return {
      ok: false,
      code: "unknown",
      message: "Removed from the team and their data access is gone, but their login couldn't be fully closed. Try again.",
    };
  }
  return ok(null);
}

export async function updateMyName(fullName: string): Promise<ActionResult<null>> {
  const parsed = z.string().trim().min(1).max(120).safeParse(fullName);
  if (!parsed.success) return invalid("Enter your name.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_profile", { p_full_name: parsed.data, p_phone: null });
  if (error) return fromDbError(error);
  refresh();
  return ok(null);
}
