import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { formatCalendarDate, formatINR } from "@/lib/domain/format";
import type { Phase } from "@/lib/domain/stages";
import { deskKpi, type TargetPlan } from "@/lib/domain/targets";
import type { PipelineKpis } from "@/lib/leads/queries";

/** One IST day, in the fields of the daily sales report. */
export function DailyReport({ day, today, month, kpis, plan }: { day: string; today: string; month: string; kpis: PipelineKpis; plan: TargetPlan }) {
  const d = (desk: Phase) => deskKpi(kpis.desks, desk, plan);
  const lead = d("lead_desk");
  const qual = d("qualification");
  const close = d("closing");
  const ops = d("operations");
  const lostCount = (desk: Phase) => kpis.loss_reasons.filter((r) => r.desk === desk).reduce((n, r) => n + r.leads, 0);
  const reasons = (desk: Phase) =>
    kpis.loss_reasons
      .filter((r) => r.desk === desk)
      .map((r) => `${r.reason || "No reason"} (${r.leads})`)
      .join(", ") || "—";

  const rows: [string, ReactNode][] = [
    ["Lead volume", `${lead.received} new leads`],
    ["Assignment", `${kpis.hygiene.unassigned} open leads unassigned now`],
    [
      "Calling",
      `${kpis.calls.attempted} calls, ${kpis.calls.connected} connected · first call within ${kpis.sla_minutes} min: ${lead.withinSla} of ${lead.received}`,
    ],
    ["BDE 1 → BDE 2", `${lead.pushed} interested leads pushed · ${lead.lost} lost (${reasons("lead_desk")})`],
    ["Qualification", `${qual.received} received · ${qual.pushed} qualified · ${lostCount("qualification")} unqualified (${reasons("qualification")})`],
    ["Quotation", `${kpis.quotes.sent} quotations sent · ${formatINR(kpis.quotes.value)} quoted`],
    ["Follow-up", `${kpis.follow_ups.due} due · ${kpis.follow_ups.completed} completed · ${kpis.follow_ups.overdue_now} overdue right now`],
    ["Closing", `${kpis.bookings.count} confirmed bookings · ${formatINR(kpis.bookings.gross)} · ${close.lost} lost (${reasons("closing")})`],
    ["Payments", `${formatINR(kpis.payments.advance)} advance · ${formatINR(kpis.payments.balance)} balance · ${formatINR(kpis.payments.refund)} refunds · ${formatINR(kpis.outstanding)} outstanding`],
    ["Operations", `${ops.received} handed over · ${ops.acknowledged} acknowledged · ${ops.chefAssigned} chef assigned · ${ops.completed} events completed`],
  ];

  return (
    <Card>
      <CardHeader
        title={`Daily report · ${formatCalendarDate(day)}`}
        description="Numbers for one day (IST). Review new, unassigned and late leads at least twice a day."
        action={
          <form className="flex items-center gap-2" action="/targets">
            <input type="hidden" name="month" value={month} />
            <Input type="date" name="day" defaultValue={day} max={today} aria-label="Day" className="w-40" />
            <Button type="submit" variant="secondary" size="sm">
              Show
            </Button>
          </form>
        }
      />
      <CardBody className="px-2 sm:px-3">
        <dl className="divide-y divide-line text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-1 px-2 py-2.5 sm:grid-cols-[160px_1fr]">
              <dt className="font-medium">{label}</dt>
              <dd className="text-fg-muted">{value}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}
