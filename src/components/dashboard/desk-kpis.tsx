import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PHASES, phaseLabel } from "@/lib/domain/stages";
import type { DeskKpi } from "@/lib/domain/targets";
import { leadsHref } from "@/lib/leads/filters";
import { cn } from "@/lib/utils";

function RateBar({ rate, target }: { rate: number | null; target: number }) {
  const width = rate === null ? 0 : Math.min(100, target > 0 ? (rate / target) * 100 : 100);
  const met = rate !== null && rate >= target;
  return (
    <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-hover">
      <div className={cn("h-full rounded-full", met ? "bg-success" : "bg-tint-amber-fg")} style={{ width: `${width}%` }} />
    </div>
  );
}

/** Open leads at a desk; for operations, bookings (which are a closed stage) at that desk. */
export function deskOpenHref(desk: DeskKpi["desk"], mine = false) {
  return leadsHref({
    phase: [desk],
    ...(desk === "operations" ? { stage: ["booked"] } : { stage_group: "open" as const }),
    ...(mine ? { owner: ["me"] } : {}),
  });
}

export function rateText(k: DeskKpi) {
  return k.rate === null ? "—" : `${k.rate.toLocaleString("en-IN")}%`;
}

/** One desk's numbers for a period: how many came in, the KPI against target, lost, open now. */
export function DeskStrip({ kpi, period, mine }: { kpi: DeskKpi; period: string; mine?: boolean }) {
  const open = deskOpenHref(kpi.desk, mine);
  return (
    <Card className="mb-6">
      <CardHeader title={`${phaseLabel(kpi.desk)} · ${period}`} description={PHASES.find((p) => p.value === kpi.desk)?.job} />
      <CardBody>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Received" value={kpi.received} />
          <div className="flex flex-col gap-1.5 rounded-xl bg-subtle px-3 py-2.5">
            <dt className="text-xs text-fg-subtle">{kpi.measure}</dt>
            <dd className="flex items-baseline gap-1.5">
              <span className="tabular text-xl font-semibold">{kpi.done.toLocaleString("en-IN")}</span>
              <span className={cn("text-[13px] font-medium", kpi.rate !== null && kpi.rate >= kpi.target ? "text-success" : "text-tint-amber-fg")}>
                {rateText(kpi)}
              </span>
            </dd>
            <RateBar rate={kpi.rate} target={kpi.target} />
            <span className="text-[11px] text-fg-subtle">Target {kpi.target}%</span>
          </div>
          <Tile label="Lost here" value={kpi.lost} />
          <Tile label="Open now" value={kpi.open} href={open} />
        </dl>
        {kpi.desk === "lead_desk" && kpi.received > 0 ? (
          <p className="mt-3 text-[13px] text-fg-muted">
            First call on time: <span className="tabular font-medium text-fg">{kpi.withinSla.toLocaleString("en-IN")}</span> of{" "}
            {kpi.received.toLocaleString("en-IN")} · pushed to BDE 2: <span className="tabular font-medium text-fg">{kpi.pushed.toLocaleString("en-IN")}</span>
          </p>
        ) : null}
        {kpi.desk === "operations" && kpi.received > 0 ? (
          <p className="mt-3 text-[13px] text-fg-muted">
            Chef assigned: <span className="tabular font-medium text-fg">{kpi.chefAssigned}</span> · events completed:{" "}
            <span className="tabular font-medium text-fg">{kpi.completed}</span>
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Tile({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <>
      <dt className="flex items-center justify-between text-xs text-fg-subtle">
        {label}
        {href ? <ChevronRight className="size-3.5" /> : null}
      </dt>
      <dd className="tabular mt-1 text-xl font-semibold">{value.toLocaleString("en-IN")}</dd>
    </>
  );
  return href ? (
    <Link href={href} className="rounded-xl bg-subtle px-3 py-2.5 hover:bg-hover">
      {body}
    </Link>
  ) : (
    <div className="rounded-xl bg-subtle px-3 py-2.5">{body}</div>
  );
}

/** The four desks side by side (managers). */
export function PipelineStrip({ kpis, period, action }: { kpis: DeskKpi[]; period: string; action?: ReactNode }) {
  return (
    <Card className="mb-4">
      <CardHeader title={`BDE pipeline · ${period}`} description="Leads received by each desk, its KPI against target, and what's open there now." action={action} />
      <CardBody>
        <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((k) => (
            <li key={k.desk} className="flex flex-col gap-2 rounded-xl border border-line p-3">
              <p className="text-sm font-semibold">{phaseLabel(k.desk)}</p>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-fg-muted">
                  {k.measure} <span className="tabular font-medium text-fg">{k.done.toLocaleString("en-IN")}</span> of{" "}
                  <span className="tabular">{k.received.toLocaleString("en-IN")}</span>
                </span>
                <span className={cn("tabular font-semibold", k.rate !== null && k.rate >= k.target ? "text-success" : "text-tint-amber-fg")}>
                  {rateText(k)}
                </span>
              </div>
              <RateBar rate={k.rate} target={k.target} />
              <p className="flex justify-between text-xs text-fg-subtle">
                <span>Target {k.target}%</span>
                <span>Lost {k.lost.toLocaleString("en-IN")}</span>
              </p>
              <Link href={deskOpenHref(k.desk)} className="text-[13px] text-fg-muted hover:text-fg hover:underline">
                {k.desk === "operations" ? "Bookings in progress" : "Open now"}: <span className="tabular font-medium text-fg">{k.open.toLocaleString("en-IN")}</span>
              </Link>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
