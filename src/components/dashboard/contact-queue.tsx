"use client";

import { CalendarDays, PhoneCall, Sparkles } from "lucide-react";
import Link from "next/link";
import { StageBadge } from "@/components/leads/badges";
import { CallLink } from "@/components/leads/call-link";
import { LeadActionsProvider, useLeadActions } from "@/components/leads/lead-actions";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { formatCalendarDate, formatDue, timeAgo } from "@/lib/domain/format";
import { guestRangeLabel, humanizeCode } from "@/lib/domain/labels";
import { cn } from "@/lib/utils";

export type QueueItem = {
  kind: "overdue" | "today" | "new" | "uncontacted" | "event";
  lead: {
    id: string;
    customer_name: string;
    phone_e164: string;
    stage: string;
    version: number;
    lead_number: number;
    occasion_code: string | null;
    guest_range: string | null;
    event_date: string | null;
    assigned_at: string | null;
    acquired_at: string;
  };
  followUp?: { id: string; due_at: string; purpose: string };
};

const SECTIONS: { kind: QueueItem["kind"]; title: string; empty?: string }[] = [
  { kind: "overdue", title: "Overdue follow-ups" },
  { kind: "today", title: "Due today" },
  { kind: "new", title: "Newly assigned" },
  { kind: "uncontacted", title: "Awaiting first call" },
  { kind: "event", title: "Events in the next 7 days" },
];

export function ContactQueue(props: {
  userId: string;
  title: string;
  items: QueueItem[];
  counts: { overdue: number; today: number; fresh: number; uncontacted: number; events: number };
}) {
  return (
    <LeadActionsProvider userId={props.userId} canAssign={false}>
      <Queue {...props} />
    </LeadActionsProvider>
  );
}

function Queue({ title, items, counts }: Parameters<typeof ContactQueue>[0]) {
  const chips = [
    { label: "Overdue", value: counts.overdue, href: "/follow-ups?tab=overdue", tone: "red" },
    { label: "Due today", value: counts.today, href: "/follow-ups?tab=today", tone: "amber" },
    { label: "New", value: counts.fresh, href: "/leads?view=recently_assigned" },
    { label: "Awaiting first call", value: counts.uncontacted, href: "/leads?view=awaiting_contact" },
    { label: "Events this week", value: counts.events, href: "/leads?view=upcoming_events" },
  ];
  const next = items[0];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-[22px] font-semibold tracking-tight md:text-2xl">{title}</h1>
      <p className="mt-1 text-sm text-fg-muted">{next ? "Here's who to contact next." : "You're all caught up."}</p>

      <div className="-mx-4 mt-4 mb-6 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
        {chips.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] hover:bg-hover"
          >
            <span
              className={cn(
                "tabular font-semibold",
                c.tone === "red" && c.value > 0 && "text-danger",
                c.tone === "amber" && c.value > 0 && "text-tint-amber-fg",
              )}
            >
              {c.value}
            </span>
            <span className="text-fg-muted">{c.label}</span>
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-line">
          <EmptyState
            icon={<Sparkles />}
            title="Nothing waiting on you"
            description="No overdue or due follow-ups and every assigned lead has been called. New assignments will appear here."
            action={
              <Link href="/leads" className={buttonVariants({ variant: "secondary" })}>
                Browse my leads
              </Link>
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {SECTIONS.map((section) => {
            const list = items.filter((i) => i.kind === section.kind);
            if (!list.length) return null;
            return (
              <section key={section.kind} aria-labelledby={`q-${section.kind}`}>
                <h2 id={`q-${section.kind}`} className="mb-2 flex items-center gap-2 text-[13px] font-medium text-fg-muted">
                  {section.title}
                  <span className="tabular rounded-full bg-subtle px-1.5 text-[11px]">{list.length}</span>
                </h2>
                <ul className="flex flex-col gap-2">
                  {list.map((item) => (
                    <QueueCard key={item.lead.id} item={item} highlight={item === next} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function reason(item: QueueItem) {
  switch (item.kind) {
    case "overdue":
      return <span className="text-danger">Overdue · was due {formatDue(item.followUp!.due_at)}</span>;
    case "today":
      return <span className="text-tint-amber-fg">Due {formatDue(item.followUp!.due_at)}</span>;
    case "new":
      return <span>Assigned {timeAgo(item.lead.assigned_at)} · not called yet</span>;
    case "uncontacted":
      return <span>Enquired {timeAgo(item.lead.acquired_at)} · no call logged yet</span>;
    case "event":
      return <span>Event on {formatCalendarDate(item.lead.event_date)}</span>;
  }
}

function QueueCard({ item, highlight }: { item: QueueItem; highlight: boolean }) {
  const actions = useLeadActions();
  const target = {
    id: item.lead.id,
    customer_name: item.lead.customer_name,
    stage: item.lead.stage,
    version: item.lead.version,
    dueFollowUp: item.followUp && item.kind !== "event" ? item.followUp : null,
  };
  return (
    <li className={cn("rounded-2xl border bg-surface", highlight ? "border-fg-subtle shadow-soft" : "border-line")}>
      <Link href={`/leads/${item.lead.id}`} className="block px-4 pt-3.5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {highlight ? <p className="mb-1 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">Next up</p> : null}
            <h3 className="truncate text-[15px] font-semibold">{item.lead.customer_name}</h3>
            <p className="mt-0.5 text-[13px]">{reason(item)}</p>
            {item.followUp && item.kind !== "event" ? <p className="mt-0.5 text-[13px] text-fg-muted">{item.followUp.purpose}</p> : null}
          </div>
          <StageBadge stage={item.lead.stage} />
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 text-xs text-fg-subtle">
          <span>{humanizeCode(item.lead.occasion_code)}</span>
          {item.lead.guest_range ? <span>{guestRangeLabel(item.lead.guest_range)} guests</span> : null}
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="size-3" /> {item.lead.event_date ? formatCalendarDate(item.lead.event_date) : "No date"}
          </span>
        </p>
      </Link>
      <div className="grid grid-cols-2 gap-2 border-t border-line p-2">
        <CallLink leadId={item.lead.id} phone={item.lead.phone_e164} variant={highlight ? "primary" : "secondary"} className="h-11" onReturn={() => actions.logCall(target, { prompted: true })} />
        <button type="button" className={buttonVariants({ variant: "secondary", className: "h-11" })} onClick={() => actions.logCall(target)}>
          <PhoneCall /> Log call
        </button>
      </div>
    </li>
  );
}
