"use client";

import {
  ArrowLeft,
  ArrowRightLeft,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  MapPin,
  Pencil,
  PhoneCall,
  StickyNote,
  UserPlus,
  Users,
  UtensilsCrossed,
  PartyPopper,
  IndianRupee,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { PageContainer } from "@/components/shell/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/states";
import { formatCalendarDate, formatDue, formatINR, formatPhone, timeAgo } from "@/lib/domain/format";
import { guestRangeLabel, humanizeCode, reviewFlagLabel } from "@/lib/domain/labels";
import type { BusinessSettings, Staff, WorkloadRow } from "@/lib/domain/types";
import type { LeadDetail } from "@/lib/leads/queries";
import { cn } from "@/lib/utils";
import { FollowUpBadge, PriorityMark, StageBadge, followUpState } from "../badges";
import { CallLink, CopyPhoneButton } from "../call-link";
import { LeadActionsProvider, useLeadActions } from "../lead-actions";
import { StageSheet } from "../stage-sheet";
import { EditDetailsSheet } from "./edit-details-sheet";
import { FollowUpList } from "./follow-up-list";
import { NotesList } from "./notes-list";
import { RelatedEnquiries } from "./related";
import { SourceDetails } from "./source-details";
import { Timeline } from "./timeline";

type Props = { detail: LeadDetail; staff: Staff; settings: BusinessSettings; workload: WorkloadRow[] };

export function LeadDetailView(props: Props) {
  const manager = props.staff.role !== "salesperson";
  return (
    <LeadActionsProvider userId={props.staff.id} workload={props.workload} canAssign={manager}>
      <Detail {...props} manager={manager} />
    </LeadActionsProvider>
  );
}

const TABS = ["activity", "notes", "follow-ups", "source", "related"] as const;
type Tab = (typeof TABS)[number];

function Detail({ detail, staff, settings, manager }: Props & { manager: boolean }) {
  const { lead, followUps, notes, events, related, importInfo } = detail;
  const actions = useLeadActions();
  const [tab, setTab] = useState<Tab>("activity");
  const [stageOpen, setStageOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const pending = followUps.filter((f) => f.status === "pending");
  const nextFollowUp = pending[0] ?? null;
  const due = pending.find((f) => followUpState(f.due_at) !== "upcoming");
  const dueFollowUp = due ? { id: due.id, purpose: due.purpose, due_at: due.due_at } : null;
  const latestNote = notes[0] ?? null;
  const callTarget = { id: lead.id, customer_name: lead.customer_name, stage: lead.stage, version: lead.version, dueFollowUp };
  const tabLabels: Record<Tab, string> = {
    activity: "Activity",
    notes: `Notes${notes.length ? ` (${notes.length})` : ""}`,
    "follow-ups": `Follow-ups${pending.length ? ` (${pending.length})` : ""}`,
    source: "Source details",
    related: `Related${related.length ? ` (${related.length})` : ""}`,
  };

  const openLogCall = (prompted = false) => actions.logCall(callTarget, { prompted });

  return (
    <PageContainer className="pb-28 md:pb-0">
      <Link href="/leads" className="mb-3 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Leads
      </Link>

      {/* Header: identity + primary actions */}
      <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{lead.customer_name}</h1>
            <button
              type="button"
              onClick={() => setStageOpen(true)}
              className="inline-flex items-center gap-0.5 rounded-full hover:opacity-80"
              aria-label="Change stage"
            >
              <StageBadge stage={lead.stage} />
              <ChevronDown className="size-4 text-fg-subtle" />
            </button>
            <PriorityMark priority={lead.priority} />
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
            <span className="inline-flex items-center gap-0.5">
              <a href={`tel:${lead.phone_e164}`} className="tabular font-medium text-fg hover:underline">
                {formatPhone(lead.phone_e164)}
              </a>
              <CopyPhoneButton phone={lead.phone_e164} compact />
            </span>
            <span className="tabular">L-{lead.lead_number}</span>
            <span className="inline-flex items-center gap-1.5">
              Owner: <span className="font-medium text-fg">{lead.owner?.full_name ?? "Unassigned"}</span>
              {manager ? (
                <button
                  type="button"
                  onClick={() => actions.assign({ kind: "ids", ids: [lead.id], currentOwnerId: lead.owner_id })}
                  className="inline-flex h-7 items-center gap-1 rounded-full border border-line px-2.5 text-[13px] font-medium text-fg hover:bg-hover"
                >
                  <UserPlus className="size-3.5" /> {lead.owner_id ? "Change" : "Assign"}
                </button>
              ) : null}
            </span>
          </p>
          {lead.closed_reason ? <p className="mt-1 text-[13px] text-fg-muted">Reason: {lead.closed_reason}</p> : null}
        </div>
        <div className="hidden flex-wrap gap-2 md:flex lg:shrink-0 lg:flex-nowrap lg:justify-end">
          <CallLink leadId={lead.id} phone={lead.phone_e164} onReturn={() => openLogCall(true)} />
          <Button variant="secondary" onClick={() => openLogCall()}>
            <PhoneCall /> Log call
          </Button>
          <Button variant="secondary" onClick={() => actions.addNote(lead)}>
            <StickyNote /> Add note
          </Button>
          <Button variant="secondary" onClick={() => actions.scheduleFollowUp(lead)}>
            <CalendarClock /> Follow-up
          </Button>
          <Button variant="secondary" onClick={() => setStageOpen(true)}>
            <ArrowRightLeft /> Stage
          </Button>
        </div>
      </header>

      {lead.review_flags?.length ? (
        <InlineAlert tone="warning" className="mb-4" title="Needs review">
          {lead.review_flags.map(reviewFlagLabel).join(" · ")}
          {lead.event_date_status === "needs_review" && lead.event_date_raw ? ` — original date text: “${lead.event_date_raw}”. ` : ". "}
          <button type="button" className="font-medium underline underline-offset-2" onClick={() => setEditOpen(true)}>
            Update details
          </button>
        </InlineAlert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* What to do next */}
          <Card className="grid gap-px overflow-hidden bg-line sm:grid-cols-2">
            <div className="bg-surface p-4">
              <p className="mb-1.5 text-xs font-medium tracking-wide text-fg-subtle uppercase">Next follow-up</p>
              {nextFollowUp ? (
                <>
                  <FollowUpBadge nextAt={nextFollowUp.due_at} />
                  <p className="mt-1.5 text-sm">{nextFollowUp.purpose}</p>
                  <p className="mt-0.5 text-xs text-fg-subtle">{nextFollowUp.assignee?.full_name ?? "Unassigned"}</p>
                </>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-fg-muted">Nothing scheduled.</p>
                  <Button size="sm" variant="secondary" onClick={() => actions.scheduleFollowUp(lead)}>
                    Schedule
                  </Button>
                </div>
              )}
            </div>
            <div className="bg-surface p-4">
              <p className="mb-1.5 text-xs font-medium tracking-wide text-fg-subtle uppercase">Latest note</p>
              {latestNote ? (
                <>
                  <p className="line-clamp-3 text-sm whitespace-pre-line">{latestNote.body}</p>
                  <p className="mt-1 text-xs text-fg-subtle">
                    {latestNote.author?.full_name ?? "Someone"} · {timeAgo(latestNote.created_at)}
                  </p>
                </>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-fg-muted">No notes yet.</p>
                  <Button size="sm" variant="secondary" onClick={() => actions.addNote(lead)}>
                    Add note
                  </Button>
                </div>
              )}
            </div>
          </Card>

          {/* Event facts */}
          <Card>
            <div className="flex items-center justify-between px-4 pt-4 sm:px-5">
              <h2 className="text-[15px] font-semibold">Event</h2>
              <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil /> Edit details
              </Button>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-4 py-4 sm:grid-cols-3 sm:px-5 xl:grid-cols-4 2xl:grid-cols-6">
              <Fact icon={<PartyPopper />} label="Occasion" value={humanizeCode(lead.occasion_code)} />
              <Fact icon={<UtensilsCrossed />} label="Menu" value={humanizeCode(lead.menu_code)} />
              <Fact icon={<Users />} label="Guests" value={guestRangeLabel(lead.guest_range)} />
              <Fact
                icon={<CalendarDays />}
                label="Event date"
                value={
                  lead.event_date ? (
                    formatCalendarDate(lead.event_date)
                  ) : lead.event_date_status === "needs_review" ? (
                    <span className="text-tint-amber-fg">Needs review{lead.event_date_raw ? ` (“${lead.event_date_raw}”)` : ""}</span>
                  ) : (
                    "—"
                  )
                }
              />
              <Fact icon={<MapPin />} label="Address" value={lead.event_address ?? "—"} className="col-span-2" />
              <Fact
                icon={<IndianRupee />}
                label={lead.stage === "booked" ? "Booking value" : "Quoted"}
                value={formatINR((lead.stage === "booked" ? lead.booking_value_inr : lead.quoted_amount_inr) as number | null)}
              />
            </dl>
          </Card>

          {/* Sections */}
          <Card>
            <div role="tablist" aria-label="Lead sections" className="flex gap-1 overflow-x-auto border-b border-line px-2 pt-2 sm:px-3">
              {TABS.map((t) => (
                <button
                  key={t}
                  role="tab"
                  type="button"
                  aria-selected={tab === t}
                  aria-controls={`panel-${t}`}
                  id={`tab-${t}`}
                  onClick={() => setTab(t)}
                  className={cn(
                    "relative h-10 shrink-0 rounded-t-lg px-3 text-sm whitespace-nowrap transition-colors",
                    tab === t ? "font-medium text-fg after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-fg" : "text-fg-muted hover:text-fg",
                  )}
                >
                  {tabLabels[t]}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="p-4 sm:p-5">
              {tab === "activity" ? <Timeline events={events} /> : null}
              {tab === "notes" ? <NotesList notes={notes} events={events} userId={staff.id} leadId={lead.id} leadName={lead.customer_name} /> : null}
              {tab === "follow-ups" ? <FollowUpList followUps={followUps} lead={lead} /> : null}
              {tab === "source" ? <SourceDetails lead={lead} importInfo={importInfo} /> : null}
              {tab === "related" ? <RelatedEnquiries related={related} /> : null}
            </div>
          </Card>
        </div>

        {/* Right rail (desktop) */}
        <aside className="hidden flex-col gap-4 lg:flex">
          <Card>
            <div className="flex items-center justify-between px-5 pt-4">
              <h2 className="text-[15px] font-semibold">Pending follow-ups</h2>
              <Button size="sm" variant="ghost" onClick={() => actions.scheduleFollowUp(lead)}>
                Add
              </Button>
            </div>
            <div className="p-5 pt-3">
              {pending.length ? (
                <ul className="flex flex-col gap-3">
                  {pending.map((f) => (
                    <li key={f.id} className="text-sm">
                      <FollowUpBadge nextAt={f.due_at} />
                      <p className="mt-1">{f.purpose}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-fg-muted">None. Schedule one so this lead doesn&apos;t go cold.</p>
              )}
            </div>
          </Card>
          <Card>
            <div className="px-5 pt-4">
              <h2 className="text-[15px] font-semibold">Other enquiries from this number</h2>
            </div>
            <div className="p-5 pt-3">
              <RelatedEnquiries related={related} compact />
            </div>
          </Card>
        </aside>
      </div>

      {/* Mobile sticky actions within thumb reach */}
      <div className="pb-safe fixed inset-x-0 bottom-16 z-30 border-t border-line bg-canvas/95 px-3 pt-2 backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-4 gap-2 pb-2">
          <CallLink leadId={lead.id} phone={lead.phone_e164} onReturn={() => openLogCall(true)} className="h-12 px-0" />
          <MobileAction label="Log call" onClick={() => openLogCall()}>
            <PhoneCall />
          </MobileAction>
          <MobileAction label="Note" onClick={() => actions.addNote(lead)}>
            <StickyNote />
          </MobileAction>
          <MobileAction label="Follow-up" onClick={() => actions.scheduleFollowUp(lead)}>
            <CalendarClock />
          </MobileAction>
        </div>
      </div>

      <StageSheet
        lead={lead}
        pendingFollowUps={pending.length}
        open={stageOpen}
        onOpenChange={setStageOpen}
        lostReasons={settings?.lost_reasons ?? []}
        unqualifiedReasons={settings?.unqualified_reasons ?? []}
      />
      <EditDetailsSheet lead={lead} open={editOpen} onOpenChange={setEditOpen} />
      {nextFollowUp && followUpState(nextFollowUp.due_at) === "overdue" ? (
        <span className="sr-only" role="status">
          Follow-up overdue since {formatDue(nextFollowUp.due_at)}
        </span>
      ) : null}
    </PageContainer>
  );
}

function Fact({ icon, label, value, className }: { icon: ReactNode; label: string; value: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="flex items-center gap-1.5 text-xs text-fg-subtle [&_svg]:size-3.5">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-sm break-words text-fg">{value}</dd>
    </div>
  );
}

function MobileAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(buttonVariants({ variant: "secondary" }), "h-12 flex-col gap-0.5 px-0 text-[11px] [&_svg]:size-[18px]")}
    >
      {children}
      {label}
    </button>
  );
}
