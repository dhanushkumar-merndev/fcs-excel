import { addDays, todayIST } from "@/lib/domain/format";
import { STAGES } from "@/lib/domain/stages";

/** Mirrors the keys understood by public.search_leads(p_filters). */
export type LeadFilters = {
  q?: string;
  owner?: string[];
  stage?: string[];
  stage_group?: "open" | "closed";
  platform?: string[];
  campaign?: string[];
  ad?: string[];
  occasion?: string[];
  menu?: string[];
  priority?: string[];
  event_status?: string[];
  event_from?: string;
  event_to?: string;
  acquired_from?: string;
  acquired_to?: string;
  imported_from?: string;
  imported_to?: string;
  closed_from?: string;
  closed_to?: string;
  follow_up?: "overdue" | "today" | "upcoming" | "none" | "due";
  review?: boolean;
  no_contact?: boolean;
  import_batch?: string;
  assigned_since?: string;
  phone?: string;
  source?: "meta_lead_ads" | "manual";
  ids?: string[];
  activity?: { type: "call" | "dial" | "follow_up_completed" | "booked"; outcome?: string; from?: string; to?: string; actor?: string };
};

const LIST_KEYS = ["owner", "stage", "platform", "campaign", "ad", "occasion", "menu", "priority", "event_status"] as const;
const DATE_KEYS = [
  "event_from", "event_to", "acquired_from", "acquired_to", "imported_from", "imported_to", "closed_from", "closed_to",
] as const;

export const SORTS = {
  acquired: { column: "acquired_at", label: "Lead created", defaultDir: "desc" },
  imported: { column: "created_at", label: "Added to CRM", defaultDir: "desc" },
  event: { column: "event_date", label: "Event date", defaultDir: "asc" },
  follow_up: { column: "next_follow_up_at", label: "Next follow-up", defaultDir: "asc" },
  activity: { column: "last_activity_at", label: "Last activity", defaultDir: "desc" },
  name: { column: "customer_name", label: "Name", defaultDir: "asc" },
  stage: { column: "stage_rank", label: "Stage", defaultDir: "asc" },
  number: { column: "lead_number", label: "Lead number", defaultDir: "desc" },
} as const;
export type SortKey = keyof typeof SORTS;

export type ListState = { filters: LeadFilters; view: ViewKey | null; sort: SortKey; dir: "asc" | "desc"; page: number; size: number };

export const VIEWS = {
  all: { label: "All leads", managerOnly: false },
  mine: { label: "My leads", managerOnly: false },
  unassigned: { label: "Unassigned", managerOnly: true },
  overdue: { label: "Overdue", managerOnly: false },
  due_today: { label: "Due today", managerOnly: false },
  upcoming_events: { label: "Upcoming events", managerOnly: false },
  awaiting_contact: { label: "Awaiting first call", managerOnly: false },
  needs_review: { label: "Needs review", managerOnly: false },
  new_this_week: { label: "New this week", managerOnly: false },
  recently_assigned: { label: "Recently assigned", managerOnly: false },
} as const;
export type ViewKey = keyof typeof VIEWS;

export function viewFilters(view: ViewKey | null, now = new Date()): { filters: LeadFilters; sort?: SortKey } {
  const today = todayIST(now);
  switch (view) {
    case "mine":
      return { filters: { owner: ["me"] } };
    case "unassigned":
      return { filters: { owner: ["unassigned"], stage_group: "open" } };
    case "overdue":
      return { filters: { follow_up: "overdue" }, sort: "follow_up" };
    case "due_today":
      return { filters: { follow_up: "today" }, sort: "follow_up" };
    case "upcoming_events":
      return {
        filters: { event_from: today, event_to: addDays(today, 14), stage: STAGES.filter((s) => s.value !== "lost" && s.value !== "unqualified").map((s) => s.value) },
        sort: "event",
      };
    case "awaiting_contact":
      return { filters: { no_contact: true }, sort: "imported" };
    case "needs_review":
      return { filters: { review: true, stage_group: "open" } };
    case "new_this_week":
      return { filters: { imported_from: addDays(today, -6) }, sort: "imported" };
    case "recently_assigned":
      return {
        filters: { owner: ["me"], assigned_since: new Date(now.getTime() - 7 * 86_400_000).toISOString() },
        sort: "imported",
      };
    default:
      return { filters: {} };
  }
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: Params, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

const isDate = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const list = (v: string | undefined) =>
  v
    ? v
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 50)
    : undefined;

/** URL → explicit filters (without the view preset). */
export function parseExplicitFilters(params: Params): LeadFilters {
  const f: LeadFilters = {};
  const q = read(params, "q")?.trim();
  if (q) f.q = q.slice(0, 100);
  for (const key of LIST_KEYS) {
    const value = list(read(params, key));
    if (value?.length) f[key] = value;
  }
  for (const key of DATE_KEYS) {
    const value = isDate(read(params, key));
    if (value) f[key] = value;
  }
  const group = read(params, "stage_group");
  if (group === "open" || group === "closed") f.stage_group = group;
  const fu = read(params, "follow_up");
  if (fu === "overdue" || fu === "today" || fu === "upcoming" || fu === "none" || fu === "due") f.follow_up = fu;
  if (read(params, "review") === "1") f.review = true;
  if (read(params, "no_contact") === "1") f.no_contact = true;
  const batch = read(params, "import");
  if (batch && /^[0-9a-f-]{36}$/i.test(batch)) f.import_batch = batch;
  const phone = read(params, "phone");
  if (phone && /^\+\d{7,15}$/.test(phone)) f.phone = phone;
  const source = read(params, "source");
  if (source === "meta_lead_ads" || source === "manual") f.source = source;
  const activity = read(params, "activity");
  if (activity === "call" || activity === "dial" || activity === "follow_up_completed" || activity === "booked") {
    f.activity = {
      type: activity,
      outcome: read(params, "activity_outcome") || undefined,
      from: isDate(read(params, "activity_from")),
      to: isDate(read(params, "activity_to")),
      actor: read(params, "activity_actor") || undefined,
    };
  }
  return f;
}

export function parseListState(params: Params): ListState {
  const viewParam = read(params, "view");
  const view = viewParam && viewParam in VIEWS ? (viewParam as ViewKey) : null;
  const preset = viewFilters(view);
  const explicit = parseExplicitFilters(params);
  const sortParam = read(params, "sort");
  const sort: SortKey = sortParam && sortParam in SORTS ? (sortParam as SortKey) : (preset.sort ?? "acquired");
  const dirParam = read(params, "dir");
  const dir = dirParam === "asc" || dirParam === "desc" ? dirParam : SORTS[sort].defaultDir;
  const page = Math.max(1, Math.min(10_000, Number(read(params, "page")) || 1));
  const sizeParam = Number(read(params, "size"));
  const size = [25, 50, 100].includes(sizeParam) ? sizeParam : 50;
  return { filters: { ...preset.filters, ...explicit }, view, sort, dir, page, size };
}

/** Filters → URL query string (explicit filters only; the view preset is carried by `view`). */
export function filtersToParams(filters: LeadFilters, extra: Record<string, string | undefined> = {}) {
  const p = new URLSearchParams();
  if (filters.q) p.set("q", filters.q);
  for (const key of LIST_KEYS) if (filters[key]?.length) p.set(key, filters[key]!.join(","));
  for (const key of DATE_KEYS) if (filters[key]) p.set(key, filters[key]!);
  if (filters.stage_group) p.set("stage_group", filters.stage_group);
  if (filters.follow_up) p.set("follow_up", filters.follow_up);
  if (filters.review) p.set("review", "1");
  if (filters.no_contact) p.set("no_contact", "1");
  if (filters.import_batch) p.set("import", filters.import_batch);
  if (filters.phone) p.set("phone", filters.phone);
  if (filters.source) p.set("source", filters.source);
  if (filters.activity) {
    p.set("activity", filters.activity.type);
    if (filters.activity.outcome) p.set("activity_outcome", filters.activity.outcome);
    if (filters.activity.from) p.set("activity_from", filters.activity.from);
    if (filters.activity.to) p.set("activity_to", filters.activity.to);
    if (filters.activity.actor) p.set("activity_actor", filters.activity.actor);
  }
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p;
}

export function leadsHref(filters: LeadFilters, extra: Record<string, string | undefined> = {}) {
  const qs = filtersToParams(filters, extra).toString();
  return qs ? `/leads?${qs}` : "/leads";
}

/** Count of user-visible filters (for the Filters button badge). */
export function activeFilterCount(f: LeadFilters) {
  let n = 0;
  for (const key of LIST_KEYS) if (f[key]?.length) n++;
  if (f.event_from || f.event_to) n++;
  if (f.acquired_from || f.acquired_to) n++;
  if (f.imported_from || f.imported_to) n++;
  if (f.closed_from || f.closed_to) n++;
  if (f.follow_up) n++;
  if (f.review) n++;
  if (f.no_contact) n++;
  if (f.stage_group) n++;
  if (f.import_batch) n++;
  if (f.activity) n++;
  if (f.phone) n++;
  if (f.source) n++;
  return n;
}

/** Filters → JSON for the search_leads RPC (assigned_since for views is computed on the server). */
export function toRpcFilters(f: LeadFilters): Record<string, unknown> {
  return JSON.parse(JSON.stringify(f));
}
