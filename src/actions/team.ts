"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { fromDbError, invalid, ok, type ActionResult } from "@/lib/action-result";
import { getStaffOrNull } from "@/lib/auth/dal";
import { siteOrigin } from "@/lib/site";
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

type LinkResult = { error: string } | { user: { id: string }; link: string };

async function linkFor(type: "invite" | "recovery" | "magiclink", email: string): Promise<LinkResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type, email } as never);
  if (error || !data?.properties?.hashed_token) return { error: error?.message ?? "Couldn't create a link." };
  const origin = await siteOrigin();
  const linkType = type === "magiclink" ? "magiclink" : type;
  return {
    user: data.user,
    link: `${origin}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=${linkType}`,
  };
}

const inviteSchema = z.object({
  fullName: z.string().trim().min(1, "Enter their name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role,
});

/**
 * Invite-only onboarding: creates the auth user, then the profile with the chosen role
 * (server-side, never from user metadata). Returns a one-time link the admin can share.
 */
export async function inviteStaff(input: z.input<typeof inviteSchema>): Promise<ActionResult<{ link: string }>> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Check the form.");
  const { fullName, email, role: newRole } = parsed.data;
  const admin = createAdminClient();

  const { data: existing } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (existing) return invalid("This email already belongs to a team member. Use “Copy sign-in link” on their row instead.");

  const generated = await linkFor("invite", email);
  if ("error" in generated) {
    return invalid(/registered|exists/i.test(generated.error) ? "This email already has a login. Contact support to link it." : generated.error);
  }
  const { error: profileError } = await admin.from("profiles").insert({
    id: generated.user.id,
    full_name: fullName,
    email,
    role: newRole,
    invited_by: gate.staff.id,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(generated.user.id).catch(() => undefined);
    return { ok: false, code: "unknown", message: "Couldn't create the team member. Nothing was saved — try again." };
  }
  await admin.from("audit_log").insert({
    actor_id: gate.staff.id,
    action: "staff_invited",
    entity_type: "profile",
    entity_id: generated.user.id,
    payload: { name: fullName, email, role: newRole },
  });
  refresh();
  return ok({ link: generated.link });
}

/** A fresh one-time sign-in link: invite for people who never signed in, password reset otherwise. */
export async function createSignInLink(userId: string): Promise<ActionResult<{ link: string; kind: "invite" | "reset" }>> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;
  if (!z.string().uuid().safeParse(userId).success) return invalid("Unknown team member.");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("email, is_active").eq("id", userId).maybeSingle();
  if (!profile) return invalid("Unknown team member.");
  if (!profile.is_active) return invalid("Reactivate this person before sending a sign-in link.");
  const { data: user } = await admin.auth.admin.getUserById(userId);
  const neverSignedIn = !user?.user?.last_sign_in_at;
  const generated = await linkFor(neverSignedIn ? "invite" : "recovery", profile.email);
  if ("error" in generated) {
    const retry = neverSignedIn ? await linkFor("recovery", profile.email) : generated;
    if ("error" in retry) return { ok: false, code: "unknown", message: retry.error };
    return ok({ link: retry.link, kind: "reset" });
  }
  return ok({ link: generated.link, kind: neverSignedIn ? "invite" : "reset" });
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

export async function updateMyName(fullName: string): Promise<ActionResult<null>> {
  const parsed = z.string().trim().min(1).max(120).safeParse(fullName);
  if (!parsed.success) return invalid("Enter your name.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_profile", { p_full_name: parsed.data, p_phone: null });
  if (error) return fromDbError(error);
  refresh();
  return ok(null);
}
