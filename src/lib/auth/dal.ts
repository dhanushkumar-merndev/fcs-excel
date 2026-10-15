import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Role, Staff } from "@/lib/domain/types";

/**
 * Data Access Layer: the only place that resolves "who is this request?". The role comes from
 * public.profiles (RLS-protected, admin-managed) — never from JWT or user metadata. Deactivated
 * staff cannot read their own profile, so they are signed out here.
 */
export const getStaffOrNull = cache(async (): Promise<Staff | null> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (!profile || !profile.is_active) return null;
  return { id: profile.id, fullName: profile.full_name, email: profile.email, role: profile.role as Role };
});

export const getCurrentStaff = cache(async (): Promise<Staff> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");
  const staff = await getStaffOrNull();
  if (!staff) redirect("/auth/signout?reason=inactive");
  return staff;
});

export async function requireRole(...roles: Role[]): Promise<Staff | null> {
  const staff = await getCurrentStaff();
  return roles.includes(staff.role) ? staff : null;
}
