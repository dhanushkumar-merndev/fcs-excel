"use server";

import { createClient as createStatelessClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { z } from "zod";
import { invalid, ok, type ActionResult } from "@/lib/action-result";
import { MIN_PASSWORD, normalizeUsername } from "@/lib/auth/username";
import { supabasePublishableKey, supabaseUrl } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type AuthFormState = { error?: string; username?: string } | undefined;

function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/auth/") ? next : "/";
}

const credentials = z.object({
  username: z.string().transform(normalizeUsername).pipe(z.string().min(1, "Enter your username.")),
  password: z.string().min(1, "Enter your password."),
});

const WRONG_CREDENTIALS = "That username and password don't match. Try again, or ask your admin to reset your password.";

/**
 * Resolves a username to the auth address behind it (server-side only, so staff emails are never
 * exposed). Older accounts can still type their email.
 */
async function loginEmail(username: string) {
  if (username.includes("@")) return username;
  const { data } = await createAdminClient().from("profiles").select("email").eq("username", username).maybeSingle();
  return data?.email ?? null;
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const username = String(formData.get("username") ?? "");
  const parsed = credentials.safeParse({ username, password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, username };

  let email: string | null;
  try {
    email = await loginEmail(parsed.data.username);
  } catch {
    return { error: "We couldn't sign you in right now. Try again in a moment.", username };
  }
  if (!email) return { error: WRONG_CREDENTIALS, username };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });
  if (error || !data.user) {
    const message = /invalid login credentials/i.test(error?.message ?? "")
      ? WRONG_CREDENTIALS
      : /banned/i.test(error?.message ?? "")
        ? "This account has been deactivated. Contact your admin."
        : "We couldn't sign you in right now. Try again in a moment.";
    return { error: message, username };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_active")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { error: "Your account isn't active in this workspace. Contact your admin.", username };
  }
  redirect(safeNext(formData.get("next")));
}

const changeSchema = z
  .object({
    current: z.string().min(1, "Enter your current password."),
    password: z.string().min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters.`).max(72, "Use at most 72 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "The new passwords don't match.", path: ["confirm"] })
  .refine((v) => v.password !== v.current, { message: "Choose a password different from your current one.", path: ["password"] });

/** Signed-in staff change their own password; the current one is checked first. */
export async function changeMyPassword(input: z.input<typeof changeSchema>): Promise<ActionResult<null>> {
  const parsed = changeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Check the form.");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.email) return { ok: false, code: "unauthenticated", message: "Your session expired. Sign in again." };

  // Verify the current password on a throwaway client so this browser's session is untouched.
  const verifier = createStatelessClient(supabaseUrl(), supabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: wrong } = await verifier.auth.signInWithPassword({ email: auth.user.email, password: parsed.data.current });
  if (wrong) return invalid(/invalid login credentials/i.test(wrong.message) ? "Your current password is incorrect." : "Couldn't check your current password. Try again.");
  await verifier.auth.signOut({ scope: "local" });

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return invalid(
      /same/i.test(error.message)
        ? "Choose a password different from your current one."
        : /weak|short|characters/i.test(error.message)
          ? error.message
          : "Couldn't save your password. Try again.",
    );
  }
  return ok(null);
}
