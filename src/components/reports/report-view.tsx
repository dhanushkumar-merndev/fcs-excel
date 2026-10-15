"use client";

import { Download, Info } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { BarList } from "@/components/charts/bar-list";
import { ColumnChart } from "@/components/charts/column-chart";
import { StatCard } from "@/components/dashboard/stat-card";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { addDays, formatCalendarDate, formatINR, todayIST } from "@/lib/domain/format";
import { callOutcomeLabel, humanizeCode, platformLabel } from "@/lib/domain/labels";
import { OPEN_STAGES, STAGES, stageLabel } from "@/lib/domain/stages";
import type { WorkloadRow } from "@/lib/domain/types";
import { leadsHref, type LeadFilters } from "@/lib/leads/filters";
import type { FilterOptions } from "@/lib/leads/queries";
import { activityLeadFilters, AGEING_BUCKETS, cohortFilters, fillDays, PRESETS, type ReportData, type ReportParams } from "@/lib/reports";
import { cn } from "@/lib/utils";

function Definition({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-[13px] text-fg-muted">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function SectionTitle({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-8 mb-3 first:mt-0">
      <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
      <div className="mt-1">{children}</div>
    </div>
  );
}

const shortDay = (iso: string) => `${Number(iso.slice(8, 10))} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(iso.slice(5, 7)) - 1]}`;

export function ReportView({
  data,
  params,
  scope,
  manager,
  options,
  workload,
  canExport,
}: {
  data: ReportData;
  params: ReportParams;
  scope: string;
  manager: boolean;
  options: FilterOptions;
  workload: WorkloadRow[];
  canExport: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [custom, setCustom] = useState({ from: params.from, to: params.to });
  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") p.delete(k);
      else p.set(k, v);
    }
    startTransition(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }));
  };

  const base = cohortFilters(params);
  const actBase = activityLeadFilters(params);
  const c = data.cohort;
  const a = data.activity;
  const snap = data.snapshot;
  const href = (extra: LeadFilters) => leadsHref({ ...base, ...extra });
  const conversion = c.total ? (c.booked / c.total) * 100 : null;
  const activity = (type: NonNullable<LeadFilters["activity"]>["type"], outcome?: string) =>
    leadsHref({ ...actBase, activity: { type, outcome, from: params.from, to: params.to, actor: params.owner ?? undefined } });
  const today = todayIST();
  const rangeLabel = `${formatCalendarDate(params.from)} – ${formatCalendarDate(params.to)}`;
  const exportQs = searchParams.toString();

  const days = fillDays(params.from, params.to, c.by_day, (day) => ({ day, leads: 0, booked: 0 }));
  const importDays = fillDays(params.from, params.to, a.imported_by_day, (day) => ({ day, leads: 0 }));

  return (
    <div className={cn("transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight md:text-2xl">Reports</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {scope} · {rangeLabel}
          </p>
        </div>
        {canExport ? (
          <a href={`/api/exports/report?${exportQs}`} className={buttonVariants({ variant: "secondary" })}>
            <Download /> Download report (.xlsx)
          </a>
        ) : null}
      </div>

      {/* Filters: one row above the charts */}
      <div className="mb-6 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-3">
        <Select aria-label="Date range" value={params.preset} onChange={(e) => set({ preset: e.target.value, from: null, to: null })} wrapperClassName="w-full sm:w-auto" className="sm:w-40">
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </Select>
        {params.preset === "custom" ? (
          <>
            <Input type="date" aria-label="From" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="w-auto" />
            <Input type="date" aria-label="To" value={custom.to} max={today} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="w-auto" />
            <button type="button" className={buttonVariants({ variant: "secondary", size: "md" })} onClick={() => set({ preset: "custom", from: custom.from, to: custom.to })}>
              Apply
            </button>
          </>
        ) : null}
        {manager ? (
          <Select aria-label="Salesperson" value={params.owner ?? ""} onChange={(e) => set({ owner: e.target.value })} wrapperClassName="w-full sm:w-auto" className="sm:w-44">
            <option value="">All salespeople</option>
            {workload.map((w) => (
              <option key={w.id} value={w.id}>
                {w.full_name}
              </option>
            ))}
          </Select>
        ) : null}
        <Select aria-label="Campaign" value={params.campaign ?? ""} onChange={(e) => set({ campaign: e.target.value })} wrapperClassName="w-full sm:w-auto" className="sm:w-52">
          <option value="">All campaigns</option>
          {options.campaigns.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
        <Select aria-label="Platform" value={params.platform ?? ""} onChange={(e) => set({ platform: e.target.value })} wrapperClassName="w-full sm:w-auto" className="sm:w-40">
          <option value="">All platforms</option>
          {options.platforms.map((v) => (
            <option key={v} value={v}>
              {platformLabel(v)}
            </option>
          ))}
        </Select>
        <Select aria-label="Stage" value={params.stage ?? ""} onChange={(e) => set({ stage: e.target.value })} wrapperClassName="w-full sm:w-auto" className="sm:w-44">
          <option value="">All stages</option>
          {STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>

      <SectionTitle title="Acquisition cohort">
        <Definition>
          Leads whose <strong>original creation time</strong> (from the lead form; entry time for manual leads) falls in {rangeLabel}, in IST. Skipped duplicate
          imports are never counted. Each event enquiry counts as its own lead.
        </Definition>
      </SectionTitle>
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Leads" value={c.total} href={href({})} />
        <StatCard label="Booked" value={c.booked} href={href({ stage: ["booked"] })} tone="green" />
        <StatCard label="Lost" value={c.lost} href={href({ stage: ["lost"] })} />
        <StatCard label="Unqualified" value={c.unqualified} href={href({ stage: ["unqualified"] })} />
        <StatCard label="Still open" value={c.open} href={href({ stage_group: "open" })} />
        <Link href={href({ stage: ["booked"] })} className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-4 hover:bg-hover/60">
          <span className="text-[13px] text-fg-muted">Conversion rate</span>
          <span className="mt-2 text-[28px] leading-none font-semibold tracking-tight">{conversion === null ? "—" : `${conversion.toFixed(1)}%`}</span>
          <span className="mt-1.5 text-xs text-fg-subtle">
            {c.booked} booked ÷ {c.total} leads in cohort
          </span>
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader title="Lead volume by day" description="By original lead creation date (IST). Click a day to open its leads." />
          <CardBody>
            <ColumnChart
              ariaLabel={`Leads per day from ${rangeLabel}`}
              points={days.map((d) => ({
                key: d.day,
                label: formatCalendarDate(d.day),
                shortLabel: shortDay(d.day),
                value: d.leads,
                detail: d.booked ? `${d.booked} booked` : undefined,
                href: leadsHref({ ...base, acquired_from: d.day, acquired_to: d.day }),
              }))}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Leads by stage" description="Current stage of leads in the cohort." />
          <CardBody>
            <BarList
              items={c.by_stage.map((s) => ({ key: s.stage, label: stageLabel(s.stage), value: s.leads, href: href({ stage: [s.stage] }) }))}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="By salesperson" description="Cohort leads by current owner." />
          <CardBody className="px-2 sm:px-3">
            {c.by_owner.length ? (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-fg-muted">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Owner</th>
                    <th className="px-2 py-1.5 text-right font-medium">Leads</th>
                    <th className="px-2 py-1.5 text-right font-medium">Open</th>
                    <th className="px-2 py-1.5 text-right font-medium">Booked</th>
                    <th className="px-2 py-1.5 text-right font-medium">Lost</th>
                  </tr>
                </thead>
                <tbody>
                  {c.by_owner.map((o) => {
                    const owner = o.owner_id ?? "unassigned";
                    return (
                      <tr key={owner} className="border-t border-line">
                        <td className="px-2 py-2">{o.name}</td>
                        <td className="tabular px-2 py-2 text-right">
                          <Link className="hover:underline" href={href({ owner: [owner] })}>
                            {o.leads}
                          </Link>
                        </td>
                        <td className="tabular px-2 py-2 text-right">
                          <Link className="hover:underline" href={href({ owner: [owner], stage_group: "open" })}>
                            {o.open}
                          </Link>
                        </td>
                        <td className="tabular px-2 py-2 text-right">
                          <Link className="hover:underline" href={href({ owner: [owner], stage: ["booked"] })}>
                            {o.booked}
                          </Link>
                        </td>
                        <td className="tabular px-2 py-2 text-right">
                          <Link className="hover:underline" href={href({ owner: [owner], stage: ["lost", "unqualified"] })}>
                            {o.lost}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="px-2 text-sm text-fg-muted">No leads in this period.</p>
            )}
            <p className="mt-3 px-2 text-xs text-fg-subtle">
              Assigned {c.assigned} · Unassigned {c.unassigned}
            </p>
          </CardBody>
        </Card>

        {(
          [
            ["Campaign", c.by_campaign, "campaign", (v: string) => v || "(No campaign)"],
            ["Ad", c.by_ad, "ad", (v: string) => v || "(No ad)"],
            ["Platform", c.by_platform, "platform", (v: string) => (v ? platformLabel(v) : "(Unknown)")],
            ["Occasion", c.by_occasion, "occasion", (v: string) => (v ? humanizeCode(v) : "(Not given)")],
          ] as const
        ).map(([title, rows, key, label]) => (
          <Card key={key}>
            <CardHeader title={`Leads and bookings by ${title.toLowerCase()}`} description="Bar = leads; booked count alongside." />
            <CardBody>
              <BarList
                items={rows.slice(0, 12).map((r) => ({
                  key: r.value || "(none)",
                  label: label(r.value),
                  value: r.leads,
                  detail: `${r.booked} booked`,
                  href: href({ [key]: [r.value] } as LeadFilters),
                }))}
              />
              {rows.length > 12 ? <p className="mt-2 px-2 text-xs text-fg-subtle">Top 12 of {rows.length}. Download the report for all.</p> : null}
            </CardBody>
          </Card>
        ))}

        <Card>
          <CardHeader title="Lead ageing" description="Open leads in the cohort by days since they were created." />
          <CardBody>
            <BarList
              items={AGEING_BUCKETS.map((b) => {
                const from = b.max === null ? params.from : [params.from, addDays(today, -b.max)].sort()[1];
                const to = [params.to, addDays(today, -b.min)].sort()[0];
                return {
                  key: b.key,
                  label: b.label,
                  value: c.ageing[b.key],
                  href: href({ stage_group: "open", acquired_from: from, acquired_to: to }),
                };
              })}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Time to first logged call" description="From when the lead entered the CRM to the first call recorded with an outcome. Dial taps don't count." />
          <CardBody>
            <div className="grid grid-cols-3 gap-2">
              <Figure label="Median" value={c.median_hours_to_first_call === null ? "—" : `${c.median_hours_to_first_call} h`} />
              <Figure label="75th percentile" value={c.p75_hours_to_first_call === null ? "—" : `${c.p75_hours_to_first_call} h`} />
              <Figure label="Leads with a logged call" value={`${c.with_logged_call} / ${c.total}`} />
            </div>
            <Link href={href({ no_contact: true })} className="mt-3 inline-block text-[13px] text-fg-muted hover:text-fg hover:underline">
              Open leads never called →
            </Link>
          </CardBody>
        </Card>

        {c.booking_value_count > 0 ? (
          <Card>
            <CardHeader title="Recorded booking value" description="Only from booked leads where a booking value was entered. Not total revenue." />
            <CardBody>
              <p className="text-[28px] leading-none font-semibold tracking-tight">{formatINR(c.booking_value_total)}</p>
              <p className="mt-2 text-[13px] text-fg-muted">
                From {c.booking_value_count} of {c.booked} booked leads ({c.booked ? Math.round((c.booking_value_count / c.booked) * 100) : 0}% coverage).
              </p>
            </CardBody>
          </Card>
        ) : null}
      </div>

      <SectionTitle title="Activity in this period">
        <Definition>
          Work done between {rangeLabel} on any lead, counted when it happened — not by when the lead was created.
          {params.owner ? " Filtered to actions by the selected salesperson." : ""} Dial taps and logged calls are separate: a tap only opens the phone app.
        </Definition>
      </SectionTitle>
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        <StatCard label="Logged calls" value={a.calls_by_outcome.reduce((s, r) => s + r.calls, 0)} href={activity("call")} />
        <StatCard label="Dial taps" value={a.dial_taps} href={activity("dial")} hint="Call button taps" />
        <StatCard label="Follow-ups completed" value={a.follow_ups_completed} href={activity("follow_up_completed")} />
        <StatCard label="Marked booked" value={a.booked_in_period} href={activity("booked")} tone="green" />
        <StatCard label="Follow-ups scheduled" value={a.follow_ups_created} href="/follow-ups?tab=upcoming" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Logged call outcomes" description="Calls recorded with an outcome. Bar = calls; leads alongside." />
          <CardBody>
            <BarList
              items={a.calls_by_outcome.map((r) => ({
                key: r.outcome,
                label: callOutcomeLabel(r.outcome),
                value: r.calls,
                detail: `${r.leads} leads`,
                href: activity("call", r.outcome),
              }))}
              empty="No calls logged in this period."
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Leads imported per day" description="Import time — when leads were added to the CRM, shown separately from acquisition." />
          <CardBody>
            <ColumnChart
              ariaLabel="Leads imported per day"
              unit="imported"
              points={importDays.map((d) => ({
                key: d.day,
                label: formatCalendarDate(d.day),
                shortLabel: shortDay(d.day),
                value: d.leads,
                href: leadsHref({ ...actBase, imported_from: d.day, imported_to: d.day, source: "meta_lead_ads" }),
              }))}
            />
          </CardBody>
        </Card>
      </div>

      <SectionTitle title="Right now">
        <Definition>Current state, regardless of the date range.</Definition>
      </SectionTitle>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatCard label="Overdue follow-ups" value={snap.overdue_follow_ups} href={`/follow-ups?tab=overdue${params.owner ? `&person=${params.owner}` : manager ? "&person=all" : ""}`} tone="red" />
        <StatCard
          label="Events in next 7 days"
          value={snap.upcoming_events_7d}
          href={leadsHref({ ...actBase, ...(params.owner ? { owner: [params.owner] } : {}), event_from: today, event_to: addDays(today, 7), stage: [...OPEN_STAGES, "booked"] })}
        />
        <StatCard
          label="Events in next 30 days"
          value={snap.upcoming_events_30d}
          href={leadsHref({ ...actBase, ...(params.owner ? { owner: [params.owner] } : {}), event_from: today, event_to: addDays(today, 30), stage: [...OPEN_STAGES, "booked"] })}
        />
        {manager ? (
          <StatCard label="Unassigned open leads" value={snap.unassigned_open} href={leadsHref({ ...actBase, owner: ["unassigned"], stage_group: "open" })} tone="amber" />
        ) : null}
      </div>
      <p className="mt-6 text-xs text-fg-subtle">Revenue, ROAS and cost per lead aren&apos;t shown: ad spend isn&apos;t tracked in this CRM.</p>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-subtle px-3 py-2.5">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
