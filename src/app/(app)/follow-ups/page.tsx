import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FollowUpsView, type FollowUpListItem } from "@/components/followups/follow-ups-view";
import { PageContainer } from "@/components/shell/page";
import { Skeleton } from "@/components/ui/card";
import { getCurrentStaff } from "@/lib/auth/dal";
import { addDays, istToInstant, todayIST } from "@/lib/domain/format";
import { getWorkload } from "@/lib/leads/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Follow-ups" };

const TABS = ["overdue", "today", "upcoming", "completed"] as const;
export type FollowUpTab = (typeof TABS)[number];
const SIZES = [25, 50, 100];

export default function FollowUpsPage(props: PageProps<"/follow-ups">) {
  return (
    <Suspense
      fallback={
        <PageContainer>
          <Skeleton className="mb-5 h-8 w-40" />
          <Skeleton className="mb-4 h-10 w-full max-w-md rounded-full" />
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="mb-2 h-20 w-full rounded-xl" />
          ))}
        </PageContainer>
      }
    >
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}

const SELECT =
  "id, lead_id, assignee_id, created_by, due_at, purpose, status, completed_at, completed_by, outcome, cancelled_at, cancel_reason, reschedule_count, created_at, version, lead:leads!inner(id, customer_name, phone_e164, stage, version, lead_number, occasion_code, event_date), assignee:profiles!follow_ups_assignee_id_fkey(full_name), completer:profiles!follow_ups_completed_by_fkey(full_name)";

async function Content({ searchParams }: { searchParams: PageProps<"/follow-ups">["searchParams"] }) {
  const [staff, params] = await Promise.all([getCurrentStaff(), searchParams]);
  const manager = staff.role !== "salesperson";
  const tabParam = typeof params.tab === "string" ? params.tab : "";
  const tab: FollowUpTab = (TABS as readonly string[]).includes(tabParam) ? (tabParam as FollowUpTab) : "today";
  const personParam = typeof params.person === "string" ? params.person : manager ? "all" : "me";
  const person = manager ? personParam : "me";
  const sizeParam = Number(params.size);
  const size = SIZES.includes(sizeParam) ? sizeParam : 50;
  const pageParam = Number(params.page);
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

  const now = new Date();
  const nowIso = now.toISOString();
  const endOfToday = istToInstant(addDays(todayIST(now), 1)).toISOString();
  const supabase = await createClient();

  const scoped = <T extends { eq: (c: string, v: string) => T; is: (c: string, v: null) => T }>(q: T) => {
    if (person === "me") return q.eq("assignee_id", staff.id);
    if (person === "unassigned") return q.is("assignee_id", null);
    if (/^[0-9a-f-]{36}$/i.test(person)) return q.eq("assignee_id", person);
    return q;
  };

  const countQuery = (kind: "overdue" | "today" | "upcoming") => {
    let q = supabase.from("follow_ups").select("id", { count: "exact", head: true }).eq("status", "pending");
    if (kind === "overdue") q = q.lt("due_at", nowIso);
    if (kind === "today") q = q.gte("due_at", nowIso).lt("due_at", endOfToday);
    if (kind === "upcoming") q = q.gte("due_at", endOfToday);
    return scoped(q);
  };

  let list = supabase.from("follow_ups").select(SELECT, { count: "exact" });
  if (tab === "completed") {
    list = list.eq("status", "completed").gte("completed_at", new Date(now.getTime() - 30 * 86_400_000).toISOString()).order("completed_at", { ascending: false });
  } else {
    list = list.eq("status", "pending").order("due_at", { ascending: true });
    if (tab === "overdue") list = list.lt("due_at", nowIso);
    if (tab === "today") list = list.gte("due_at", nowIso).lt("due_at", endOfToday);
    if (tab === "upcoming") list = list.gte("due_at", endOfToday);
  }
  list = scoped(list)
    .order("id", { ascending: true })
    .range((page - 1) * size, page * size - 1);

  const [items, overdue, today, upcoming, workload] = await Promise.all([
    list,
    countQuery("overdue"),
    countQuery("today"),
    countQuery("upcoming"),
    manager ? getWorkload() : Promise.resolve([]),
  ]);
  if (items.error?.code === "PGRST103") {
    // Page past the end (the list shrank since the link was made): start over at page 1.
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (k !== "page" && typeof v === "string") p.set(k, v);
    redirect(`/follow-ups?${p.toString()}`);
  }
  if (items.error) throw new Error(items.error.message);

  return (
    <FollowUpsView
      tab={tab}
      person={person}
      manager={manager}
      userId={staff.id}
      items={(items.data ?? []) as unknown as FollowUpListItem[]}
      total={items.count ?? 0}
      page={page}
      size={size}
      counts={{ overdue: overdue.count ?? 0, today: today.count ?? 0, upcoming: upcoming.count ?? 0 }}
      workload={workload}
    />
  );
}
