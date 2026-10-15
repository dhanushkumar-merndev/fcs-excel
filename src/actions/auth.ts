"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { siteOrigin } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

export type AuthFormState = { error?: string; success?: string; email?: string } | undefined;

function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/auth/") ? next : "/";
}

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, email };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    const message = /invalid login credentials/i.test(error?.message ?? "")
      ? "That email and password don't match. Try again or reset your password."
      : /banned/i.test(error?.message ?? "")
        ? "This account has been deactivated. Contact your admin."
        : "We couldn't sign you in right now. Try again in a moment.";
    return { error: message, email };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_active")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { error: "Your account isn't active in this workspace. Contact your admin.", email };
  }
  redirect(safeNext(formData.get("next")));
}

export async function requestPasswordReset(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  if (!email.success) return { error: "Enter a valid email address." };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${await siteOrigin()}/auth/confirm?next=/set-password`,
  });
  // Same message whether or not the account exists.
  return {
    success:
      "If that email belongs to a team member, a reset link is on its way. If it doesn't arrive, ask your admin for a reset link.",
  };
}

const passwordSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords don't match.", path: ["confirm"] });

export async function setPassword(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = passwordSchema.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return { error: "This link has expired. Ask your admin for a new invite or reset link." };
  }
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return {
      error: /same/i.test(error.message)
        ? "Choose a password different from your current one."
        : /weak|short|characters/i.test(error.message)
          ? error.message
          : "We couldn't save your password. Try again.",
    };
  }
  redirect("/");
}
