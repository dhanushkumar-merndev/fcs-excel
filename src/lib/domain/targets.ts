/**
 * Monthly sales targets, desk KPIs and the 100-point desk scorecard. Pure functions shared by the
 * Targets page, dashboards and tests. The database returns raw counts (public.pipeline_kpis); every
 * rate and score is computed here.
 */
import type { SalesTargetRow } from "./types";
import { PHASES, type Phase } from "./stages";

export type TargetPlan = {
  leadsPerDay: number;
  workingDays: number;
  /** BDE 1: % of leads pushed to BDE 2. 100 = the doc's "every valid lead goes on". */
  pushRate: number;
  /** BDE 2: % of received leads qualified. */
  qualificationRate: number;
  /** BDE 3: % of qualified leads that become advance-paid bookings. */
  closingRate: number;
  chefTicket: number;
  cateringTicket: number;
  /** % of bookings that are Chef on Demand (the rest are Catering). */
  chefMixPct: number;
};

/** The standard planning scenario: 40 leads/day × 26 days, 70% qualified, 40% booked, 80:20 mix. */
export const DEFAULT_PLAN: TargetPlan = {
  leadsPerDay: 40,
  workingDays: 26,
  pushRate: 100,
  qualificationRate: 70,
  closingRate: 40,
  chefTicket: 2500,
  cateringTicket: 40000,
  chefMixPct: 80,
};

export const SCENARIOS = [
  { key: "low", label: "Low volume", leadsPerDay: 30 },
  { key: "standard", label: "Standard", leadsPerDay: 40 },
  { key: "high", label: "High volume", leadsPerDay: 50 },
] as const;

export function planFromRow(row: SalesTargetRow | null | undefined): TargetPlan {
  if (!row) return { ...DEFAULT_PLAN };
  return {
    leadsPerDay: Number(row.leads_per_day),
    workingDays: Number(row.working_days),
    pushRate: Number(row.push_rate),
    qualificationRate: Number(row.qualification_rate),
    closingRate: Number(row.closing_rate),
    chefTicket: Number(row.chef_ticket_inr),
    cateringTicket: Number(row.catering_ticket_inr),
    chefMixPct: Number(row.chef_mix_pct),
  };
}

const pct = (n: number, rate: number) => Math.round((n * rate) / 100);

export type Funnel = {
  leads: number;
  pushed: number;
  qualified: number;
  bookings: number;
  chefBookings: number;
  cateringBookings: number;
  chefRevenue: number;
  cateringRevenue: number;
  revenue: number;
};

/**
 * The month's target funnel. Each step is rounded to whole leads, and the service mix is applied to
 * the rounded booking count, exactly as in the planning document (1,040 → 728 → 291 → 233 + 58).
 */
export function targetFunnel(plan: TargetPlan): Funnel {
  const leads = plan.leadsPerDay * plan.workingDays;
  const pushed = pct(leads, plan.pushRate);
  const qualified = pct(pushed, plan.qualificationRate);
  const bookings = pct(qualified, plan.closingRate);
  const chefBookings = pct(bookings, plan.chefMixPct);
  const cateringBookings = bookings - chefBookings;
  const chefRevenue = chefBookings * plan.chefTicket;
  const cateringRevenue = cateringBookings * plan.cateringTicket;
  return { leads, pushed, qualified, bookings, chefBookings, cateringBookings, chefRevenue, cateringRevenue, revenue: chefRevenue + cateringRevenue };
}

/** A share of the month's targets (e.g. working days elapsed ÷ working days), rounded. */
export function prorate(f: Funnel, fraction: number): Funnel {
  const k = Math.max(0, Math.min(1, fraction));
  const r = (n: number) => Math.round(n * k);
  return {
    leads: r(f.leads),
    pushed: r(f.pushed),
    qualified: r(f.qualified),
    bookings: r(f.bookings),
    chefBookings: r(f.chefBookings),
    cateringBookings: r(f.cateringBookings),
    chefRevenue: r(f.chefRevenue),
    cateringRevenue: r(f.cateringRevenue),
    revenue: r(f.revenue),
  };
}

// ---------------------------------------------------------------------------
// Desk KPIs from pipeline_kpis
// ---------------------------------------------------------------------------
export type DeskMetricRow = { desk: string; metric: string; leads: number };
export type PersonMetricRow = DeskMetricRow & { person_id: string };

export type DeskKpi = {
  desk: Phase;
  received: number;
  pushed: number;
  lost: number;
  open: number;
  attended: number;
  withinSla: number;
  acknowledged: number;
  chefAssigned: number;
  completed: number;
  /** The desk's KPI, as a percentage, or null when nothing reached the desk. */
  rate: number | null;
  /** The KPI's target percentage. */
  target: number;
  /** What the KPI counts ("Attended", "Qualified", "Booked", "Handed over"). */
  measure: string;
  /** The count the rate is made of (rate = done ÷ received). */
  done: number;
};

const MEASURES: Record<Phase, string> = {
  lead_desk: "Attended",
  qualification: "Qualified",
  closing: "Booked",
  operations: "Handed over",
};

export function deskTarget(desk: Phase, plan: TargetPlan) {
  return desk === "qualification" ? plan.qualificationRate : desk === "closing" ? plan.closingRate : 100;
}

export function rate(done: number, of: number): number | null {
  return of > 0 ? Math.round((done / of) * 1000) / 10 : null;
}

export function deskKpi(rows: DeskMetricRow[], desk: Phase, plan: TargetPlan): DeskKpi {
  const get = (metric: string) => rows.filter((r) => r.desk === desk && r.metric === metric).reduce((n, r) => n + Number(r.leads), 0);
  const received = get("received");
  const pushed = get("pushed");
  const attended = get("attended");
  const acknowledged = get("acknowledged");
  const done = desk === "lead_desk" ? attended : desk === "operations" ? acknowledged : pushed;
  return {
    desk,
    received,
    pushed,
    lost: get("lost"),
    open: get("open"),
    attended,
    withinSla: get("within_sla"),
    acknowledged,
    chefAssigned: get("chef_assigned"),
    completed: get("completed"),
    rate: rate(done, received),
    target: deskTarget(desk, plan),
    measure: MEASURES[desk],
    done,
  };
}

export function deskKpis(rows: DeskMetricRow[], plan: TargetPlan): DeskKpi[] {
  return PHASES.map((p) => deskKpi(rows, p.value, plan));
}

/** Per person: each person's numbers on each desk they worked in the range. */
export function personKpis(rows: PersonMetricRow[], plan: TargetPlan) {
  const byPerson = new Map<string, PersonMetricRow[]>();
  for (const r of rows) byPerson.set(r.person_id, [...(byPerson.get(r.person_id) ?? []), r]);
  return [...byPerson.entries()].map(([personId, own]) => ({
    personId,
    desks: PHASES.map((p) => deskKpi(own, p.value, plan)).filter((k) => k.received > 0 || k.open > 0 || k.pushed > 0 || k.lost > 0),
  }));
}

// ---------------------------------------------------------------------------
// 100-point scorecard
// ---------------------------------------------------------------------------
export const SCORE_WEIGHTS: Record<Phase, number> = { lead_desk: 25, qualification: 25, closing: 30, operations: 20 };

export const RATINGS = [
  { min: 90, label: "Excellent", tint: "green" },
  { min: 80, label: "Very Good", tint: "teal" },
  { min: 70, label: "Satisfactory", tint: "blue" },
  { min: 60, label: "Needs Improvement", tint: "amber" },
  { min: -Infinity, label: "Performance Improvement Plan", tint: "red" },
] as const;

export function rating(score: number) {
  return RATINGS.find((r) => score >= r.min)!;
}

/** A desk's marks: its weight × how close the KPI is to target, capped at the weight. */
export function deskScore(k: DeskKpi): number | null {
  if (k.rate === null) return null;
  const weight = SCORE_WEIGHTS[k.desk];
  const attainment = k.target > 0 ? Math.min(1, k.rate / k.target) : 1;
  return Math.round(weight * attainment * 10) / 10;
}

export type Scorecard = {
  desks: { desk: Phase; weight: number; score: number | null }[];
  /** Out of 100. When a desk had nothing to work on, the others are scaled up to 100. */
  total: number | null;
  partial: boolean;
  rating: (typeof RATINGS)[number] | null;
};

export function scorecard(kpis: DeskKpi[]): Scorecard {
  const desks = kpis.map((k) => ({ desk: k.desk, weight: SCORE_WEIGHTS[k.desk], score: deskScore(k) }));
  const scored = desks.filter((d) => d.score !== null);
  if (scored.length === 0) return { desks, total: null, partial: false, rating: null };
  const weight = scored.reduce((n, d) => n + d.weight, 0);
  const marks = scored.reduce((n, d) => n + (d.score ?? 0), 0);
  const total = Math.round((marks / weight) * 1000) / 10;
  return { desks, total, partial: scored.length < desks.length, rating: rating(total) };
}
