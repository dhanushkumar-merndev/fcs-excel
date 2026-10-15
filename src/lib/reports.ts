import { addDays, todayIST } from "@/lib/domain/format";
import type { LeadFilters } from "@/lib/leads/filters";

export type ReportParams = {
  from: string;
  to: string;
  preset: string;
  owner: string | null;
  campaign: string | null;
  platform: string | null;
  stage: string | null;
};

export const PRESETS = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
  { key: "month", label: "This month", days: 0 },
  { key: "custom", label: "Custom", days: 0 },
] as const;

const isDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const one = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);

export function parseReportParams(params: Record<string, string | string[] | undefined> | URLSearchParams): ReportParams {
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) ?? undefined : Array.isArray(params[k]) ? params[k]![0] : (params[k] as string | undefined));
  const today = todayIST();
  const preset = get("preset") ?? "30d";
  let from = isDate(get("from"));
  let to = isDate(get("to"));
  if (preset !== "custom" || !from || !to) {
    const p = PRESETS.find((x) => x.key === preset) ?? PRESETS[1];
    to = today;
    from = p.key === "month" ? `${today.slice(0, 8)}01` : addDays(today, -((p.days || 30) - 1));
  }
  if (from > to) [from, to] = [to, from];
  return {
    from,
    to,
    preset: PRESETS.some((p) => p.key === preset) ? preset : "30d",
    owner: one(get("owner")),
    campaign: one(get("campaign")),
    platform: one(get("platform")),
    stage: one(get("stage")),
  };
}

/** Report filters → the same search_leads filter object used for drill-down links. */
export function cohortFilters(p: ReportParams): LeadFilters {
  return {
    acquired_from: p.from,
    acquired_to: p.to,
    ...(p.owner ? { owner: [p.owner] } : {}),
    ...(p.campaign ? { campaign: [p.campaign] } : {}),
    ...(p.platform ? { platform: [p.platform] } : {}),
    ...(p.stage ? { stage: [p.stage] } : {}),
  };
}

/** Non-date filters that also scope activity metrics (salesperson applies to who acted). */
export function activityLeadFilters(p: ReportParams): LeadFilters {
  return {
    ...(p.campaign ? { campaign: [p.campaign] } : {}),
    ...(p.platform ? { platform: [p.platform] } : {}),
  };
}

export type ReportData = {
  cohort: {
    total: number;
    booked: number;
    lost: number;
    unqualified: number;
    open: number;
    assigned: number;
    unassigned: number;
    with_logged_call: number;
    with_dial: number;
    median_hours_to_first_call: number | null;
    p75_hours_to_first_call: number | null;
    booking_value_total: number | null;
    booking_value_count: number;
    by_stage: { stage: string; leads: number }[];
    by_day: { day: string; leads: number; booked: number }[];
    by_campaign: { value: string; leads: number; booked: number }[];
    by_ad: { value: string; leads: number; booked: number }[];
    by_platform: { value: string; leads: number; booked: number }[];
    by_occasion: { value: string; leads: number; booked: number }[];
    by_owner: { owner_id: string | null; name: string; leads: number; open: number; booked: number; lost: number }[];
    ageing: Record<"0_2" | "3_7" | "8_14" | "15_30" | "31_plus", number>;
  };
  activity: {
    calls_by_outcome: { outcome: string; calls: number; leads: number }[];
    dial_taps: number;
    follow_ups_completed: number;
    follow_ups_created: number;
    booked_in_period: number;
    lost_in_period: number;
    imported_by_day: { day: string; leads: number }[];
  };
  snapshot: { overdue_follow_ups: number; upcoming_events_7d: number; upcoming_events_30d: number; unassigned_open: number };
  generated_at: string;
};

/** Fills missing days so the time series has no silent gaps. */
export function fillDays<T extends { day: string }>(from: string, to: string, rows: T[], empty: (day: string) => T) {
  const map = new Map(rows.map((r) => [r.day, r]));
  const out: T[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(map.get(d) ?? empty(d));
  return out;
}

export const AGEING_BUCKETS = [
  { key: "0_2", label: "0–2 days", min: 0, max: 2 },
  { key: "3_7", label: "3–7 days", min: 3, max: 7 },
  { key: "8_14", label: "8–14 days", min: 8, max: 14 },
  { key: "15_30", label: "15–30 days", min: 15, max: 30 },
  { key: "31_plus", label: "31+ days", min: 31, max: null },
] as const;
