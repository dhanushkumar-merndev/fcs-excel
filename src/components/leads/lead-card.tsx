"use client";

import { CalendarDays, PhoneCall, Users } from "lucide-react";
import Link from "next/link";
import { formatCalendarDate } from "@/lib/domain/format";
import { guestRangeLabel, humanizeCode } from "@/lib/domain/labels";
import type { LeadWithOwner } from "@/lib/domain/types";
import { buttonVariants } from "@/components/ui/button";
import { FollowUpBadge, PriorityMark, StageBadge } from "./badges";
import { CallLink } from "./call-link";
import { useLeadActions } from "./lead-actions";

/** Mobile lead card: the facts needed to decide the next action, with Call / Log call in thumb reach. */
export function LeadCard({ lead, showOwner }: { lead: LeadWithOwner; showOwner: boolean }) {
  const actions = useLeadActions();
  const callTarget = { id: lead.id, customer_name: lead.customer_name, stage: lead.stage, version: lead.version };
  return (
    <article className="rounded-2xl border border-line bg-surface">
      <Link href={`/leads/${lead.id}`} className="block px-4 pt-3.5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold">{lead.customer_name}</h3>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-muted">
              <span>{humanizeCode(lead.occasion_code)}</span>
              {lead.guest_range ? (
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3.5" aria-hidden /> {guestRangeLabel(lead.guest_range)}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3.5" aria-hidden />
                {lead.event_date
                  ? formatCalendarDate(lead.event_date)
                  : lead.event_date_status === "needs_review"
                    ? "Date needs review"
                    : "No date"}
              </span>
            </p>
          </div>
          <StageBadge stage={lead.stage} />
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <FollowUpBadge nextAt={lead.next_follow_up_at} />
          <PriorityMark priority={lead.priority} />
          {showOwner ? (
            <span className="ml-auto text-xs text-fg-subtle">{lead.owner?.full_name ?? "Unassigned"}</span>
          ) : null}
        </div>
      </Link>
      <div className="grid grid-cols-2 gap-2 border-t border-line p-2">
        <CallLink
          leadId={lead.id}
          phone={lead.phone_e164}
          variant="secondary"
          className="h-11"
          onReturn={() => actions.logCall(callTarget, { prompted: true })}
        />
        <button type="button" className={buttonVariants({ variant: "secondary", className: "h-11" })} onClick={() => actions.logCall(callTarget)}>
          <PhoneCall /> Log call
        </button>
      </div>
    </article>
  );
}
