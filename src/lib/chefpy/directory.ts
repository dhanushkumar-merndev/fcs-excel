import { z } from "zod";

/**
 * Chef directory published by the Chefpy app (chefdemo) at GET /api/integrations/chefs.
 * Chefpy lives in its own Supabase project, so FCS reads it over HTTP with a shared token
 * instead of holding Chefpy's database key. Chefpy decides each chef's status:
 *   pending/rejected → not yet approved
 *   booked           → holds a won bid on an awarded order, or an upcoming/in-progress booking
 *   offline          → approved but switched themselves off
 *   available        → approved, online and free
 */

export const CHEF_STATUSES = ["available", "booked", "offline", "pending", "rejected"] as const;
export type ChefStatus = (typeof CHEF_STATUSES)[number];

const engagement = z.object({
  kind: z.enum(["booking", "awarded_bid"]),
  code: z.string(),
  service: z.string(),
  customer: z.string(),
  region: z.string().catch(""),
  location: z.string().catch(""),
  scheduled_start: z.string(),
  scheduled_end: z.string(),
  amount: z.number().nullable().catch(null),
});

const chef = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().catch(""),
  email: z.string().catch(""),
  chef_type: z.string().catch(""),
  cuisine: z.string().catch(""),
  experience: z.number().catch(0),
  region: z.string().catch(""),
  location: z.string().catch(""),
  online: z.boolean().catch(false),
  approval_status: z.enum(["pending", "approved", "rejected"]),
  registered_at: z.string().nullable().catch(null),
  status: z.enum(CHEF_STATUSES),
  current: engagement.nullable().catch(null),
  open_bids: z.number().catch(0),
});

export const directorySchema = z.object({
  generated_at: z.string(),
  chefs: z.array(chef),
});

export type Chef = z.infer<typeof chef>;
export type ChefDirectory = z.infer<typeof directorySchema>;

export type DirectoryResult =
  | { ok: true; data: ChefDirectory }
  | {
      ok: false;
      reason: "unconfigured" | "unauthorized" | "unreachable" | "upstream" | "upstreamUnconfigured" | "invalid";
      detail?: string;
    };

export const CHEF_TYPE_LABELS: Record<string, string> = {
  home_cook: "Home cook",
  professional_chef: "Professional chef",
  caterer: "Caterer",
  baker: "Baker",
  tandoor_specialist: "Tandoor specialist",
};

export function chefTypeLabel(type: string) {
  return CHEF_TYPE_LABELS[type] ?? "";
}

export type ChefCounts = Record<ChefStatus, number> & { total: number };

export function countByStatus(chefs: Chef[]): ChefCounts {
  const counts: ChefCounts = { total: chefs.length, available: 0, booked: 0, offline: 0, pending: 0, rejected: 0 };
  for (const c of chefs) counts[c.status] += 1;
  return counts;
}

/** Booked first (most relevant to staff), then available, offline, pending, rejected; A–Z inside. */
export function sortChefs(chefs: Chef[]): Chef[] {
  const rank: Record<ChefStatus, number> = { booked: 0, available: 1, offline: 2, pending: 3, rejected: 4 };
  return [...chefs].sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function matchesQuery(c: Chef, q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const digits = needle.replace(/\D/g, "");
  return (
    [c.name, c.cuisine, c.region, c.location, c.email, chefTypeLabel(c.chef_type), c.current?.code ?? ""].some((v) =>
      v.toLowerCase().includes(needle),
    ) || (digits.length >= 3 && c.phone.replace(/\D/g, "").includes(digits))
  );
}
