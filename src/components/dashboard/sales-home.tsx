import "server-only";
import { addDays, istParts, istToInstant, todayIST } from "@/lib/domain/format";
import type { Staff } from "@/lib/domain/types";
import { createClient } from "@/lib/supabase/server";
import { ContactQueue, type QueueItem } from "./contact-queue";

const LEAD_FIELDS = "id, customer_name, phone_e164, stage, version, lead_number, occasion_code, guest_range, event_date, event_date_status, assigned_at, acquired_at, next_follow_up_at";

function greeting(now: Date) {
  const h = istParts(now).hour;
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** "Who should I contact next?" — one prioritized queue for the salesperson. */
export async function SalesHome({ staff }: { staff: Staff }) {
  const supabase = await createClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const today = todayIST(now);
  const endOfToday = istToInstant(addDays(today, 1)).toISOString();
  const open = "(booked,lost,unqualified)";

  const [overdue, dueToday, fresh, uncontacted, events, summary] = await Promise.all([
    supabase
      .from("follow_ups")
      .select(`id, due_at, purpose, version, lead:leads!inner(${LEAD_FIELDS})`)
      .eq("status", "pending")
      .eq("assignee_id", staff.id)
      .lt("due_at", nowIso)
      .order("due_at")
      .limit(50),
    supabase
      .from("follow_ups")
      .select(`id, due_at, purpose, version, lead:leads!inner(${LEAD_FIELDS})`)
      .eq("status", "pending")
      .eq("assignee_id", staff.id)
      .gte("due_at", nowIso)
      .lt("due_at", endOfToday)
      .order("due_at")
      .limit(50),
    supabase
      .from("leads")
      .select(LEAD_FIELDS)
      .eq("owner_id", staff.id)
      .gte("assigned_at", new Date(now.getTime() - 48 * 3600e3).toISOString())
      .is("first_call_logged_at", null)
      .not("stage", "in", open)
      .order("assigned_at", { ascending: false })
      .limit(30),
    supabase
      .from("leads")
      .select(LEAD_FIELDS)
      .eq("owner_id", staff.id)
      .is("first_call_logged_at", null)
      .not("stage", "in", open)
      .order("acquired_at", { ascending: false })
      .limit(30),
    supabase
      .from("leads")
      .select(LEAD_FIELDS)
      .eq("owner_id", staff.id)
      .gte("event_date", today)
      .lte("event_date", addDays(today, 7))
      .not("stage", "in", "(lost,unqualified)")
      .order("event_date")
      .limit(30),
    supabase.rpc("dashboard_summary"),
  ]);

  const seen = new Set<string>();
  const items: QueueItem[] = [];
  type FU = { id: string; due_at: string; purpose: string; version: number; lead: QueueItem["lead"] };
  const push = (item: QueueItem) => {
    if (seen.has(item.lead.id)) return;
    seen.add(item.lead.id);
    items.push(item);
  };
  for (const f of (overdue.data ?? []) as unknown as FU[]) push({ kind: "overdue", lead: f.lead, followUp: f });
  for (const f of (dueToday.data ?? []) as unknown as FU[]) push({ kind: "today", lead: f.lead, followUp: f });
  for (const l of (fresh.data ?? []) as unknown as QueueItem["lead"][]) push({ kind: "new", lead: l });
  for (const l of (uncontacted.data ?? []) as unknown as QueueItem["lead"][]) push({ kind: "uncontacted", lead: l });
  for (const l of (events.data ?? []) as unknown as QueueItem["lead"][]) push({ kind: "event", lead: l });

  const s = (summary.data ?? {}) as Record<string, number>;
  const firstName = staff.fullName.split(" ")[0];

  return (
    <ContactQueue
      userId={staff.id}
      title={`${greeting(now)}, ${firstName}`}
      items={items}
      counts={{
        overdue: s.my_overdue ?? overdue.data?.length ?? 0,
        today: s.my_due_today ?? dueToday.data?.length ?? 0,
        fresh: fresh.data?.length ?? 0,
        uncontacted: s.awaiting_first_contact ?? 0,
        events: s.upcoming_events_7d ?? 0,
      }}
    />
  );
}
