"use client";

import { CalendarCheck, PhoneCall } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CallLink } from "@/components/leads/call-link";
import { FollowUpItem } from "@/components/leads/detail/follow-up-list";
import { LeadActionsProvider, useLeadActions } from "@/components/leads/lead-actions";
import { PageContainer, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { formatCalendarDate, formatDateTime, formatDue } from "@/lib/domain/format";
import { humanizeCode } from "@/lib/domain/labels";
import type { FollowUpRow, WorkloadRow } from "@/lib/domain/types";
import { cn, formatCount } from "@/lib/utils";

export type FollowUpListItem = FollowUpRow & {
  lead: { id: string; customer_name: string; phone_e164: string; stage: string; version: number; lead_number: number; occasion_code: string | null; event_date: string | null };
  assignee: { full_name: string } | null;
  completer: { full_name: string } | null;
};

type Tab = "overdue" | "today" | "upcoming" | "completed";

export function FollowUpsView(props: {
  tab: Tab;
  person: string;
  manager: boolean;
  userId: string;
  items: FollowUpListItem[];
  total: number;
  page: number;
  size: number;
  counts: { overdue: number; today: number; upcoming: number };
  workload: WorkloadRow[];
}) {
  return (
    <LeadActionsProvider userId={props.userId} workload={props.workload} canAssign={props.manager}>
      <View {...props} />
    </LeadActionsProvider>
  );
}

function View({ tab, person, manager, items, total, page, size, counts, workload }: Parameters<typeof FollowUpsView>[0]) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const actions = useLeadActions();

  const go = (key: string, value: string, resetPage = true) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set(key, value);
    if (resetPage) p.delete("page");
    startTransition(() => router.replace(`${pathname}?${p.toString()}`, { scroll: key === "page" }));
  };
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);

  const tabs: { key: Tab; label: string; count?: number; tone?: string }[] = [
    { key: "overdue", label: "Overdue", count: counts.overdue, tone: "red" },
    { key: "today", label: "Today", count: counts.today },
    { key: "upcoming", label: "Upcoming", count: counts.upcoming },
    { key: "completed", label: "Completed" },
  ];

  const empty: Record<Tab, { title: string; description: string }> = {
    overdue: { title: "Nothing overdue", description: "Every follow-up is on time. Nice work." },
    today: { title: "No more follow-ups today", description: "Check upcoming follow-ups or work on leads awaiting a first call." },
    upcoming: { title: "Nothing scheduled ahead", description: "Schedule follow-ups from a lead so nothing goes cold." },
    completed: { title: "No completed follow-ups in the last 30 days", description: "Completed follow-ups appear here." },
  };

  return (
    <PageContainer>
      <PageHeader
        title="Follow-ups"
        description="Times shown in IST. Overdue items stay here until they're done, rescheduled or cancelled."
        actions={
          manager ? (
            <Select aria-label="Show follow-ups for" value={person} onChange={(e) => go("person", e.target.value)} className="w-auto min-w-48">
              <option value="all">Everyone</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
              {workload.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.full_name}
                </option>
              ))}
            </Select>
          ) : null
        }
      />
      <div role="tablist" aria-label="Follow-up views" className="mb-4 flex gap-1.5 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => go("tab", t.key)}
            className={cn(
              "flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium transition-colors",
              tab === t.key ? "bg-fg text-canvas" : "bg-subtle text-fg-muted hover:bg-hover hover:text-fg",
            )}
          >
            {t.label}
            {t.count !== undefined ? (
              <span
                className={cn(
                  "tabular rounded-full px-1.5 text-[11px]",
                  t.tone === "red" && t.count > 0 ? "bg-tint-red text-tint-red-fg" : tab === t.key ? "bg-canvas/20" : "bg-hover",
                )}
              >
                {t.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className={cn("transition-opacity", pending && "opacity-60")} aria-busy={pending}>
        {items.length === 0 ? (
          <div className="rounded-2xl border border-line">
            <EmptyState icon={<CalendarCheck />} title={empty[tab].title} description={empty[tab].description} />
          </div>
        ) : tab === "completed" ? (
          <ul className="flex flex-col gap-2">
            {items.map((f) => (
              <li key={f.id} className="rounded-xl border border-line px-4 py-3">
                <Link href={`/leads/${f.lead.id}`} className="text-sm font-medium hover:underline">
                  {f.lead.customer_name}
                </Link>
                <p className="mt-0.5 text-sm">{f.purpose}</p>
                <p className="mt-0.5 text-xs text-fg-subtle">
                  Completed by {f.completer?.full_name ?? "someone"} · {formatDateTime(f.completed_at)}
                  {f.outcome ? ` · ${f.outcome}` : ""} · was due {formatDue(f.due_at)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((f) => (
              <FollowUpItem
                key={f.id}
                followUp={f}
                leadName={f.lead.customer_name}
                leadLink={
                  <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link href={`/leads/${f.lead.id}`} className="text-[15px] font-semibold hover:underline">
                      {f.lead.customer_name}
                    </Link>
                    <span className="text-xs text-fg-subtle">
                      {humanizeCode(f.lead.occasion_code)}
                      {f.lead.event_date ? ` · Event ${formatCalendarDate(f.lead.event_date)}` : ""}
                    </span>
                    <span className="ml-auto flex gap-1.5">
                      <CallLink
                        leadId={f.lead.id}
                        phone={f.lead.phone_e164}
                        size="sm"
                        variant="secondary"
                        onReturn={() =>
                          actions.logCall(
                            { ...f.lead, dueFollowUp: { id: f.id, purpose: f.purpose, due_at: f.due_at } },
                            { prompted: true },
                          )
                        }
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => actions.logCall({ ...f.lead, dueFollowUp: { id: f.id, purpose: f.purpose, due_at: f.due_at } })}
                      >
                        <PhoneCall /> Log
                      </Button>
                    </span>
                  </div>
                }
              />
            ))}
          </ul>
        )}
      </div>

      {total > 0 ? (
        <div className="mt-4 flex flex-col items-center justify-between gap-3 text-sm text-fg-muted sm:flex-row md:sticky md:bottom-0 md:z-20 md:mt-2 md:border-t md:border-line md:bg-canvas/95 md:py-3 md:backdrop-blur">
          <p className="tabular">
            Showing {formatCount(from)}–{formatCount(to)} of {formatCount(total)}
          </p>
          <div className="flex items-center gap-2">
            <Select aria-label="Rows per page" className="h-9 w-auto" value={String(size)} onChange={(e) => go("size", e.target.value)}>
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} per page
                </option>
              ))}
            </Select>
            <Button variant="secondary" size="sm" disabled={page <= 1 || pending} onClick={() => go("page", String(page - 1), false)}>
              Previous
            </Button>
            <span className="tabular px-1">
              {page} / {pages}
            </span>
            <Button variant="secondary" size="sm" disabled={page >= pages || pending} onClick={() => go("page", String(page + 1), false)}>
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </PageContainer>
  );
}
