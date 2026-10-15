"use client";

import { ExternalLink } from "lucide-react";
import { StageBadge } from "@/components/leads/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { formatCalendarDate } from "@/lib/domain/format";
import { humanizeCode } from "@/lib/domain/labels";
import type { DuplicateWarning } from "@/lib/import/duplicates";
import type { Decision, PreparedImport, PreparedRow } from "@/lib/import/prepare";
import { cn } from "@/lib/utils";
import { Stat } from "./review-step";

export function DuplicatesStep({
  plan,
  decisions,
  onDecide,
}: {
  plan: PreparedImport;
  decisions: Record<number, Decision>;
  onDecide: (updates: Record<number, Decision>) => void;
}) {
  const exact = plan.rows.filter((r) => r.review.forcedSkip);
  const events = plan.rows.filter((r) => !r.review.forcedSkip && r.row.valid && r.review.needsDecision);
  const repeat = plan.rows.filter((r) => !r.review.forcedSkip && r.row.valid && !r.review.needsDecision && r.review.warnings.length > 0);

  if (!exact.length && !events.length && !repeat.length) {
    return (
      <Card>
        <EmptyState title="No duplicates found" description="No row matches an existing lead or another row in this file." />
      </Card>
    );
  }

  const decideAll = (rows: PreparedRow[], d: Decision) => onDecide(Object.fromEntries(rows.map((r) => [r.row.rowNumber, d])));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat label="Already imported — will be skipped" value={exact.length} />
        <Stat label="Possible duplicate events — decide" value={events.length} tone={events.length ? "amber" : undefined} />
        <Stat label="Repeat customers — new enquiries" value={repeat.length} />
      </div>

      {events.length ? (
        <Section
          title="Possible duplicate events"
          description="Same phone and the same confirmed event date with similar details. Decide for each: keep it as a separate enquiry, or skip it."
          actions={
            <>
              <Button size="sm" variant="secondary" onClick={() => decideAll(events, "import")}>
                Keep all
              </Button>
              <Button size="sm" variant="secondary" onClick={() => decideAll(events, "skip")}>
                Skip all
              </Button>
            </>
          }
        >
          {events.map((r) => (
            <DuplicateCard key={r.row.rowNumber} row={r} decision={decisions[r.row.rowNumber]} onDecide={(d) => onDecide({ [r.row.rowNumber]: d })} strong />
          ))}
        </Section>
      ) : null}

      {repeat.length ? (
        <Section
          title="Repeat customers"
          description="Same phone as an existing enquiry but a different event. They're imported as separate enquiries; earlier enquiries keep their owner, notes and history."
          actions={
            <Button size="sm" variant="secondary" onClick={() => decideAll(repeat, "skip")}>
              Skip all
            </Button>
          }
        >
          {repeat.map((r) => (
            <DuplicateCard
              key={r.row.rowNumber}
              row={r}
              decision={decisions[r.row.rowNumber] ?? "import"}
              onDecide={(d) => onDecide({ [r.row.rowNumber]: d })}
            />
          ))}
        </Section>
      ) : null}

      {exact.length ? (
        <Section
          title="Already imported"
          description="These source leads exist already (same lead ID), or repeat an earlier row of this file. They're skipped and linked to the existing record — nothing is overwritten."
        >
          {exact.map((r) => (
            <DuplicateCard key={r.row.rowNumber} row={r} decision="skip" />
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, description, actions, children }: { title: string; description: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <div className="flex flex-col gap-2 border-b border-line px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-fg-muted">{description}</p>
        </div>
        {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
      </div>
      <ul className="flex max-h-[560px] flex-col gap-2 overflow-y-auto p-3 sm:p-4">{children}</ul>
    </Card>
  );
}

function MatchSummary({ warning }: { warning: DuplicateWarning }) {
  if (warning.lead) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        <span className="font-medium">
          L-{warning.lead.number} · {warning.lead.name}
        </span>
        <StageBadge stage={warning.lead.stage} />
        <span className="text-fg-muted">
          Event {warning.lead.eventDate ? formatCalendarDate(warning.lead.eventDate) : "unknown"} · {warning.lead.ownerName ?? "Unassigned"}
        </span>
        <a href={`/leads/${warning.lead.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-fg underline underline-offset-2">
          Open existing lead <ExternalLink className="size-3" />
        </a>
      </div>
    );
  }
  if (warning.row) {
    return (
      <p className="text-[13px] text-fg-muted">
        Row {warning.row.rowNumber}: {warning.row.name} · Event {warning.row.eventDate ? formatCalendarDate(warning.row.eventDate) : "unknown"}
      </p>
    );
  }
  return null;
}

function DuplicateCard({
  row,
  decision,
  onDecide,
  strong,
}: {
  row: PreparedRow;
  decision?: Decision;
  onDecide?: (d: Decision) => void;
  strong?: boolean;
}) {
  const lead = row.row.lead;
  return (
    <li className={cn("rounded-xl border p-3.5", strong && decision === undefined ? "border-tint-amber-fg/40 bg-tint-amber/30" : "border-line")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="tabular text-fg-muted">Row {row.row.rowNumber}</span> · <span className="font-medium">{lead.customer_name}</span> ·{" "}
            {humanizeCode(lead.occasion_code)} · Event {lead.event_date ? formatCalendarDate(lead.event_date) : lead.event_date_raw ? `“${lead.event_date_raw}”` : "unknown"}
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {row.review.warnings.map((w, i) => (
              <li key={i} className="rounded-lg bg-subtle px-3 py-2">
                <p className="mb-1 flex items-center gap-2 text-[13px]">
                  <Badge tint={w.kind === "possible_duplicate_event" ? "amber" : w.kind === "repeat_customer" ? "blue" : "gray"} className="h-5 px-2 text-[11px]">
                    {w.kind === "possible_duplicate_event" ? "Possible duplicate event" : w.kind === "repeat_customer" ? "Repeat customer" : "Already imported"}
                  </Badge>
                  {w.reason}
                </p>
                <MatchSummary warning={w} />
              </li>
            ))}
          </ul>
        </div>
        {onDecide ? (
          <div className="flex shrink-0 gap-1.5" role="radiogroup" aria-label={`Decision for row ${row.row.rowNumber}`}>
            <Button size="sm" role="radio" aria-checked={decision === "import"} variant={decision === "import" ? "primary" : "secondary"} onClick={() => onDecide("import")}>
              Keep as separate enquiry
            </Button>
            <Button size="sm" role="radio" aria-checked={decision === "skip"} variant={decision === "skip" ? "primary" : "secondary"} onClick={() => onDecide("skip")}>
              Skip
            </Button>
          </div>
        ) : (
          <Badge className="shrink-0">Skipped</Badge>
        )}
      </div>
    </li>
  );
}
