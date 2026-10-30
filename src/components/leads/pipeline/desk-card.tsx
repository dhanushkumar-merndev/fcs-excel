"use client";

import { ArrowRight, BadgeCheck, Check, ChefHat, CircleCheckBig, Handshake, IndianRupee, MoveRight, Shuffle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { opsUpdate } from "@/actions/pipeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatCalendarDate, formatDateTime, formatINR, formatPhone } from "@/lib/domain/format";
import { PAYMENT_KINDS, PAYMENT_MODES } from "@/lib/domain/labels";
import { PHASES, isClosedStage, nextPhase, phaseLabel, phaseShort, type Phase } from "@/lib/domain/stages";
import type { LeadDetail } from "@/lib/leads/queries";
import { useRequestId } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { useRunAction } from "../use-run-action";
import { ConfirmBookingSheet } from "./booking-sheet";
import { HandoffSheet, type DeskMember, type Requirement } from "./handoff-sheet";
import { ChefSheet, CompleteEventSheet } from "./ops-sheets";
import { PaymentSheet } from "./payment-sheet";

type Lead = LeadDetail["lead"];

export function paymentTotals(payments: LeadDetail["payments"], bookingValue: unknown) {
  let advance = 0;
  let balance = 0;
  let refund = 0;
  for (const p of payments) {
    const n = Number(p.amount_inr);
    if (p.kind === "advance") advance += n;
    else if (p.kind === "balance") balance += n;
    else refund += n;
  }
  const paid = advance + balance - refund;
  const value = bookingValue === null || bookingValue === undefined || bookingValue === "" ? null : Number(bookingValue);
  return { advance, balance, refund, paid, due: value === null ? null : Math.max(0, value - paid) };
}

export function requirementsFor(lead: Lead, events: LeadDetail["events"]): Partial<Record<Phase, Requirement[]>> {
  return {
    qualification: [
      {
        label: "Connected call logged",
        met: events.some((e) => e.event_type === "call_logged" && (e.payload as { outcome?: string }).outcome === "connected"),
      },
    ],
    closing: [
      { label: "Event type", met: Boolean(lead.occasion_code) },
      { label: "Event date", met: Boolean(lead.event_date) },
      { label: "Location", met: Boolean(lead.event_address) },
      { label: "Guest count", met: Boolean(lead.guest_range) },
      { label: "Service", met: Boolean(lead.service_type) },
      { label: "Budget", met: lead.budget_inr !== null && lead.budget_inr !== undefined },
    ],
  };
}

type Open = "handoff" | "move" | "payment" | "booking" | "chef" | "complete" | null;

/**
 * Where the lead is in the four-desk pipeline and what that desk does next: push it on, take
 * payments, confirm the booking, or run operations. Shown on every lead; handoffs need the
 * pipeline switched on.
 */
export function DeskCard({
  detail,
  manager,
  pipelineOn,
  members,
  pendingFollowUps,
  onEditDetails,
}: {
  detail: LeadDetail;
  manager: boolean;
  pipelineOn: boolean;
  members?: DeskMember[];
  pendingFollowUps: number;
  onEditDetails: () => void;
}) {
  const { lead, payments, handoffs, events } = detail;
  const run = useRunAction();
  const [ackId, rotateAck] = useRequestId();
  const [open, setOpen] = useState<Open>(null);
  const [acking, setAcking] = useState(false);
  const close = (next: boolean) => !next && setOpen(null);

  const phase = lead.phase as Phase;
  const closed = isClosedStage(lead.stage);
  const booked = lead.stage === "booked";
  const lost = closed && !booked;
  const next = nextPhase(phase);
  const totals = paymentTotals(payments, lead.booking_value_inr);
  const requirements = requirementsFor(lead, events);
  const rank = PHASES.findIndex((p) => p.value === phase);
  const canTakePayment = !lost && (phase === "closing" || phase === "operations" || booked);
  const inOps = booked && phase === "operations";

  async function acknowledge() {
    setAcking(true);
    const result = await run(() => opsUpdate({ requestId: ackId, leadId: lead.id, version: lead.version, action: "acknowledge" }), {
      success: "Handover acknowledged",
    });
    setAcking(false);
    if (result.ok) rotateAck();
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            BDE desk
            <Badge tint={lost ? "red" : booked ? "green" : "blue"}>{lost ? `Lost at ${phaseShort(phase)}` : phaseLabel(phase)}</Badge>
          </span>
        }
        description={
          pipelineOn ? PHASES[rank]?.job : "The BDE pipeline is off, so the desk simply follows the stage. An admin can switch it on from the Team page."
        }
        action={
          manager && pipelineOn && !closed ? (
            <Button size="sm" variant="ghost" onClick={() => setOpen("move")}>
              <Shuffle /> Move desk
            </Button>
          ) : null
        }
      />
      <CardBody className="flex flex-col gap-4">
        {/* Desk steps */}
        <ol className="grid grid-cols-4 gap-1.5" aria-label="Desks">
          {PHASES.map((p, i) => {
            const done = i < rank || (i === rank && (p.value === "operations" ? Boolean(lead.event_completed_at) : false));
            const current = i === rank;
            return (
              <li
                key={p.value}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex min-w-0 flex-col gap-0.5 rounded-xl border px-2.5 py-2 text-xs",
                  current ? (lost ? "border-danger/50 bg-tint-red" : "border-fg bg-subtle") : "border-line",
                  !current && !done && "text-fg-subtle",
                )}
              >
                <span className="flex items-center gap-1 font-semibold">
                  {done ? <Check className="size-3.5 text-success" /> : null}
                  {p.short}
                </span>
                <span className="truncate text-fg-muted">{p.label.split("· ")[1]}</span>
              </li>
            );
          })}
        </ol>

        {/* What this desk does next */}
        {!closed && pipelineOn ? (
          <div className="flex flex-wrap gap-2">
            {phase === "lead_desk" || phase === "qualification" ? (
              <Button onClick={() => setOpen("handoff")}>
                {phase === "lead_desk" ? "Interested → push to BDE 2" : "Qualified → push to BDE 3"} <ArrowRight />
              </Button>
            ) : null}
            {phase === "closing" ? (
              <>
                <Button variant="secondary" onClick={() => setOpen("payment")}>
                  <IndianRupee /> Record payment
                </Button>
                <Button onClick={() => setOpen("booking")}>
                  <Handshake /> Confirm booking
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
        {!closed && !pipelineOn ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setOpen("payment")}>
              <IndianRupee /> Record payment
            </Button>
            <Button variant="secondary" onClick={() => setOpen("booking")}>
              <Handshake /> Confirm booking
            </Button>
          </div>
        ) : null}

        {/* Operations checklist */}
        {inOps ? (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
            <OpsStep
              icon={<BadgeCheck />}
              title="Handover acknowledged"
              done={Boolean(lead.handover_acknowledged_at)}
              detail={lead.handover_acknowledged_at ? formatDateTime(lead.handover_acknowledged_at as string) : "Verify the booking details and payment."}
              action={
                !lead.handover_acknowledged_at ? (
                  <Button size="sm" onClick={() => void acknowledge()} loading={acking}>
                    Acknowledge
                  </Button>
                ) : null
              }
            />
            <OpsStep
              icon={<ChefHat />}
              title={lead.chef_name ? `Chef: ${lead.chef_name}` : "Chef assigned"}
              done={Boolean(lead.chef_name)}
              detail={
                lead.chef_name
                  ? [lead.chef_phone ? formatPhone(lead.chef_phone as string) : null, lead.ops_notes].filter(Boolean).join(" · ") || "No notes"
                  : "Who is cooking, and what they need to know."
              }
              action={
                <Button size="sm" variant={lead.chef_name ? "ghost" : "primary"} onClick={() => setOpen("chef")}>
                  {lead.chef_name ? "Edit" : "Assign chef"}
                </Button>
              }
            />
            <OpsStep
              icon={<CircleCheckBig />}
              title="Event completed"
              done={Boolean(lead.event_completed_at)}
              detail={
                lead.event_completed_at
                  ? formatDateTime(lead.event_completed_at as string)
                  : lead.event_date
                    ? `Event on ${formatCalendarDate(lead.event_date)}`
                    : "Event date not set"
              }
              action={
                !lead.event_completed_at ? (
                  <Button size="sm" variant="secondary" onClick={() => setOpen("complete")} disabled={!lead.chef_name}>
                    Mark completed
                  </Button>
                ) : null
              }
            />
          </ul>
        ) : null}

        {/* Payments */}
        {canTakePayment || payments.length ? (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Payments</h3>
              {canTakePayment && booked ? (
                <Button size="sm" variant="ghost" onClick={() => setOpen("payment")}>
                  <IndianRupee /> Record payment
                </Button>
              ) : null}
            </div>
            <dl className="mb-2 grid grid-cols-3 gap-2 text-sm">
              <Money label={booked ? "Booking value" : "Quoted"} value={formatINR((booked ? lead.booking_value_inr : lead.quoted_amount_inr) as number | null)} />
              <Money label="Paid" value={formatINR(totals.paid)} />
              <Money label="Balance due" value={totals.due === null ? "—" : formatINR(totals.due)} tone={totals.due ? "amber" : undefined} />
            </dl>
            {payments.length ? (
              <ul className="divide-y divide-line text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="font-medium">{PAYMENT_KINDS.find((k) => k.value === p.kind)?.label}</span>
                      <span className="text-fg-muted">
                        {" "}
                        · {formatCalendarDate(p.paid_on)}
                        {p.mode ? ` · ${PAYMENT_MODES.find((m) => m.value === p.mode)?.label}` : ""}
                        {p.reference ? ` · ${p.reference}` : ""}
                      </span>
                      <span className="block text-xs text-fg-subtle">
                        {p.recorder?.full_name ?? "Someone"}
                        {p.note ? ` · ${p.note}` : ""}
                      </span>
                    </span>
                    <span className={cn("tabular shrink-0 font-medium", p.kind === "refund" && "text-danger")}>
                      {p.kind === "refund" ? "−" : ""}
                      {formatINR(p.amount_inr)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">No payments yet.</p>
            )}
          </div>
        ) : null}

        {/* Handoffs */}
        {handoffs.length ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold">Handoffs</h3>
            <ol className="flex flex-col gap-2 text-sm">
              {handoffs.map((h) => (
                <li key={h.id}>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{phaseShort(h.from_phase)}</span>
                    <span className="text-fg-muted">{h.from_owner?.full_name ?? "Unassigned"}</span>
                    <MoveRight className="size-3.5 text-fg-subtle" />
                    <span className="font-medium">{phaseShort(h.to_phase)}</span>
                    <span className="text-fg-muted">{h.to_owner?.full_name ?? "Unassigned"}</span>
                    <span className="text-xs text-fg-subtle">· {formatDateTime(h.created_at)}</span>
                  </span>
                  {h.note ? <span className="mt-0.5 block text-[13px] whitespace-pre-line text-fg-muted">{h.note}</span> : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </CardBody>

      {next && next !== "operations" ? (
        <HandoffSheet
          lead={lead}
          toPhase={next}
          requirements={requirements}
          members={manager ? members : undefined}
          open={open === "handoff"}
          onOpenChange={close}
          onEditDetails={onEditDetails}
        />
      ) : null}
      {manager ? (
        <HandoffSheet
          lead={lead}
          toPhase={PHASES.find((p) => p.value !== phase && p.value !== "operations")!.value}
          choosePhase
          requirements={requirements}
          members={members}
          open={open === "move"}
          onOpenChange={close}
          onEditDetails={onEditDetails}
        />
      ) : null}
      <PaymentSheet
        lead={lead}
        defaultKind={booked ? "balance" : "advance"}
        paidTotal={totals.paid}
        open={open === "payment"}
        onOpenChange={close}
      />
      <ConfirmBookingSheet
        lead={lead}
        advancePaid={totals.advance > 0 && totals.paid > 0 ? totals.advance : 0}
        pendingFollowUps={pendingFollowUps}
        pipelineOn={pipelineOn}
        open={open === "booking"}
        onOpenChange={close}
        onRecordAdvance={() => setOpen("payment")}
      />
      {inOps ? (
        <>
          <ChefSheet lead={opsLead(lead)} open={open === "chef"} onOpenChange={close} />
          <CompleteEventSheet lead={opsLead(lead)} open={open === "complete"} onOpenChange={close} />
        </>
      ) : null}
    </Card>
  );
}

function opsLead(lead: Lead) {
  return {
    id: lead.id,
    version: lead.version,
    customer_name: lead.customer_name,
    chef_name: lead.chef_name,
    chef_phone: lead.chef_phone,
    ops_notes: lead.ops_notes,
  };
}

function OpsStep({ icon, title, detail, done, action }: { icon: ReactNode; title: string; detail: ReactNode; done: boolean; action?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4",
          done ? "bg-tint-green text-tint-green-fg" : "bg-subtle text-fg-muted",
        )}
      >
        {done ? <Check /> : icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block truncate text-[13px] text-fg-muted">{detail}</span>
      </span>
      {action}
    </li>
  );
}

function Money({ label, value, tone }: { label: string; value: string; tone?: "amber" }) {
  return (
    <div className="rounded-xl bg-subtle px-3 py-2">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className={cn("tabular mt-0.5 font-semibold", tone === "amber" && "text-tint-amber-fg")}>{value}</dd>
    </div>
  );
}
