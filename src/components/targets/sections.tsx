import Link from "next/link";
import { rateText } from "@/components/dashboard/desk-kpis";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatINR } from "@/lib/domain/format";
import { serviceTypeLabel } from "@/lib/domain/labels";
import { PHASES, phaseLabel, phaseShort, type Phase } from "@/lib/domain/stages";
import { SCORE_WEIGHTS, deskScore, personKpis, scorecard, type DeskKpi, type Funnel, type TargetPlan } from "@/lib/domain/targets";
import { leadsHref } from "@/lib/leads/filters";
import type { PipelineKpis } from "@/lib/leads/queries";
import { cn } from "@/lib/utils";

const metric = (k: PipelineKpis, desk: Phase, m: string) => k.desks.filter((r) => r.desk === desk && r.metric === m).reduce((n, r) => n + r.leads, 0);

/** Month to date against the month's target and against where the month should be by now. */
export function ActualVsTarget({
  kpis,
  funnel,
  pace,
  elapsed,
  daysInMonth,
}: {
  kpis: PipelineKpis;
  funnel: Funnel;
  pace: Funnel;
  elapsed: number;
  daysInMonth: number;
}) {
  const chef = kpis.bookings.by_service.find((b) => b.service === "chef_on_demand");
  const catering = kpis.bookings.by_service.find((b) => b.service === "catering");
  const rows: { label: string; actual: number; target: number; pace: number; money?: boolean }[] = [
    { label: "Leads received (BDE 1)", actual: metric(kpis, "lead_desk", "received"), target: funnel.leads, pace: pace.leads },
    { label: "Pushed to BDE 2", actual: metric(kpis, "lead_desk", "pushed"), target: funnel.pushed, pace: pace.pushed },
    { label: "Qualified → BDE 3", actual: metric(kpis, "qualification", "pushed"), target: funnel.qualified, pace: pace.qualified },
    { label: "Confirmed bookings", actual: kpis.bookings.count, target: funnel.bookings, pace: pace.bookings },
    { label: "· Chef on Demand", actual: chef?.count ?? 0, target: funnel.chefBookings, pace: pace.chefBookings },
    { label: "· Catering Services", actual: catering?.count ?? 0, target: funnel.cateringBookings, pace: pace.cateringBookings },
    { label: "Gross booking revenue", actual: kpis.bookings.gross, target: funnel.revenue, pace: pace.revenue, money: true },
  ];
  const fmt = (n: number, money?: boolean) => (money ? formatINR(n) : n.toLocaleString("en-IN"));
  return (
    <Card>
      <CardHeader
        title="Month to date"
        description={`Day ${elapsed} of ${daysInMonth}. "On pace" is the share of the monthly target due by today.`}
      />
      <CardBody className="overflow-x-auto px-2 sm:px-3">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-fg-muted">
            <tr>
              <th className="px-2 py-1.5 font-medium">Measure</th>
              <th className="px-2 py-1.5 text-right font-medium">Actual</th>
              <th className="px-2 py-1.5 text-right font-medium">On pace</th>
              <th className="px-2 py-1.5 text-right font-medium">Month target</th>
              <th className="px-2 py-1.5 text-right font-medium">Achieved</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pct = r.target > 0 ? Math.round((r.actual / r.target) * 100) : null;
              return (
                <tr key={r.label} className="border-t border-line">
                  <td className={cn("px-2 py-2", r.label.startsWith("·") && "pl-5 text-fg-muted")}>{r.label.replace(/^· /, "")}</td>
                  <td className={cn("tabular px-2 py-2 text-right font-medium", r.actual >= r.pace ? "text-success" : "text-tint-amber-fg")}>{fmt(r.actual, r.money)}</td>
                  <td className="tabular px-2 py-2 text-right text-fg-muted">{fmt(r.pace, r.money)}</td>
                  <td className="tabular px-2 py-2 text-right">{fmt(r.target, r.money)}</td>
                  <td className="tabular px-2 py-2 text-right text-fg-muted">{pct === null ? "—" : `${pct}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}

export function ScorecardCard({ desks }: { desks: DeskKpi[] }) {
  const card = scorecard(desks);
  return (
    <Card>
      <CardHeader
        title="Team scorecard"
        description="Each desk's KPI against target, worth 25 / 25 / 30 / 20 marks."
        action={
          card.total !== null ? (
            <span className="flex items-center gap-2">
              <span className="tabular text-xl font-semibold">{card.total}</span>
              <Badge tint={card.rating!.tint}>{card.rating!.label}</Badge>
            </span>
          ) : null
        }
      />
      <CardBody className="px-2 sm:px-3">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-fg-muted">
            <tr>
              <th className="px-2 py-1.5 font-medium">Desk</th>
              <th className="px-2 py-1.5 text-right font-medium">KPI</th>
              <th className="px-2 py-1.5 text-right font-medium">Target</th>
              <th className="px-2 py-1.5 text-right font-medium">Marks</th>
            </tr>
          </thead>
          <tbody>
            {desks.map((k) => {
              const d = card.desks.find((x) => x.desk === k.desk)!;
              return (
                <tr key={k.desk} className="border-t border-line">
                  <td className="px-2 py-2">
                    <span className="block">{phaseLabel(k.desk)}</span>
                    <span className="text-xs text-fg-subtle">
                      {k.measure} {k.done.toLocaleString("en-IN")} of {k.received.toLocaleString("en-IN")}
                    </span>
                  </td>
                  <td className={cn("tabular px-2 py-2 text-right font-medium", k.rate !== null && k.rate >= k.target ? "text-success" : "text-tint-amber-fg")}>
                    {rateText(k)}
                  </td>
                  <td className="tabular px-2 py-2 text-right text-fg-muted">{k.target}%</td>
                  <td className="tabular px-2 py-2 text-right">
                    {d.score === null ? "—" : d.score} <span className="text-fg-subtle">/ {d.weight}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {card.partial ? (
          <p className="mt-2 px-2 text-xs text-fg-subtle">Desks with no leads this period aren&apos;t scored; the total is scaled to 100 over the others.</p>
        ) : null}
        <p className="mt-2 px-2 text-xs text-fg-subtle">90+ Excellent · 80+ Very Good · 70+ Satisfactory · 60+ Needs Improvement · below 60 Performance Improvement Plan.</p>
      </CardBody>
    </Card>
  );
}

export function RevenueCard({ kpis }: { kpis: PipelineKpis }) {
  const p = kpis.payments;
  const items: [string, number, string?][] = [
    ["Gross booked", kpis.bookings.gross, `${kpis.bookings.count.toLocaleString("en-IN")} bookings confirmed`],
    ["Advance collected", p.advance],
    ["Balance collected", p.balance],
    ["Refunds", p.refund],
    ["Outstanding now", kpis.outstanding, "Booking value not yet paid"],
    ["Realized", kpis.realized, "Value of events completed"],
  ];
  return (
    <Card>
      <CardHeader title="Revenue" description="Kept apart on purpose: what's booked isn't what's collected or delivered." />
      <CardBody className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {items.map(([label, value, hint]) => (
            <div key={label} className="rounded-xl bg-subtle px-3 py-2.5">
              <dt className="text-xs text-fg-subtle">{label}</dt>
              <dd className="tabular mt-0.5 font-semibold">{formatINR(value)}</dd>
              {hint ? <dd className="text-[11px] text-fg-subtle">{hint}</dd> : null}
            </div>
          ))}
        </dl>
        {kpis.bookings.by_service.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {kpis.bookings.by_service.map((b) => (
              <li key={b.service} className="flex justify-between gap-3">
                <Link className="hover:underline" href={leadsHref({ stage: ["booked"], ...(b.service ? { service_type: [b.service] } : {}) })}>
                  {b.service ? serviceTypeLabel(b.service) : "Service not set"}
                </Link>
                <span className="tabular text-fg-muted">
                  {b.count.toLocaleString("en-IN")} · {formatINR(b.gross)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function PeopleTable({
  people,
  plan,
  names,
  deskOf,
}: {
  people: PipelineKpis["people"];
  plan: TargetPlan;
  names: Map<string, string>;
  deskOf: Map<string, Phase | null>;
}) {
  const rows = personKpis(people, plan)
    .flatMap((p) => p.desks.map((k) => ({ personId: p.personId, k })))
    .filter((r) => r.k.received > 0 || r.k.open > 0)
    .sort((a, b) => PHASES.findIndex((x) => x.value === a.k.desk) - PHASES.findIndex((x) => x.value === b.k.desk) || (names.get(a.personId) ?? "").localeCompare(names.get(b.personId) ?? ""));
  return (
    <Card>
      <CardHeader title="By person" description="Each person's numbers on the desks they worked this period. Marks use the same weights as the team scorecard." />
      <CardBody className="overflow-x-auto px-2 sm:px-3">
        {rows.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-fg-muted">
              <tr>
                <th className="px-2 py-1.5 font-medium">Person</th>
                <th className="px-2 py-1.5 font-medium">Desk</th>
                <th className="px-2 py-1.5 text-right font-medium">Received</th>
                <th className="px-2 py-1.5 text-right font-medium">Done</th>
                <th className="px-2 py-1.5 text-right font-medium">KPI</th>
                <th className="px-2 py-1.5 text-right font-medium">Lost</th>
                <th className="px-2 py-1.5 text-right font-medium">Open now</th>
                <th className="px-2 py-1.5 text-right font-medium">Marks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ personId, k }) => {
                const score = deskScore(k);
                return (
                  <tr key={`${personId}-${k.desk}`} className="border-t border-line">
                    <td className="px-2 py-2">
                      {names.get(personId) ?? "Former member"}
                      {deskOf.get(personId) && deskOf.get(personId) !== k.desk ? (
                        <span className="block text-xs text-fg-subtle">Now on {phaseShort(deskOf.get(personId))}</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">{phaseShort(k.desk)}</td>
                    <td className="tabular px-2 py-2 text-right">{k.received}</td>
                    <td className="tabular px-2 py-2 text-right">
                      {k.done} <span className="text-xs text-fg-subtle">{k.measure.toLowerCase()}</span>
                    </td>
                    <td className={cn("tabular px-2 py-2 text-right font-medium", k.rate !== null && k.rate >= k.target ? "text-success" : "text-tint-amber-fg")}>
                      {rateText(k)}
                    </td>
                    <td className="tabular px-2 py-2 text-right">{k.lost}</td>
                    <td className="tabular px-2 py-2 text-right">
                      <Link className="hover:underline" href={leadsHref({ owner: [personId], phase: [k.desk] })}>
                        {k.open}
                      </Link>
                    </td>
                    <td className="tabular px-2 py-2 text-right">
                      {score === null ? "—" : score} <span className="text-fg-subtle">/ {SCORE_WEIGHTS[k.desk]}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="px-2 text-sm text-fg-muted">No desk activity in this period yet.</p>
        )}
      </CardBody>
    </Card>
  );
}

export function LossReasons({ reasons }: { reasons: PipelineKpis["loss_reasons"] }) {
  if (!reasons.length) return null;
  return (
    <Card>
      <CardHeader title="Why leads were lost" description="By the desk where they closed. Check these to keep qualification honest." />
      <CardBody className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PHASES.map((p) => {
          const list = reasons.filter((r) => r.desk === p.value);
          if (!list.length) return null;
          return (
            <div key={p.value}>
              <p className="mb-1.5 text-sm font-semibold">{p.label}</p>
              <ul className="flex flex-col gap-1 text-sm">
                {list.map((r) => (
                  <li key={r.reason} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{r.reason || "No reason"}</span>
                    <span className="tabular text-fg-muted">{r.leads}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
