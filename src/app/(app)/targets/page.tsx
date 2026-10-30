import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer, PageHeader } from "@/components/shell/page";
import { DailyReport } from "@/components/targets/daily-report";
import { PlanForm } from "@/components/targets/plan-form";
import { ActualVsTarget, LossReasons, PeopleTable, RevenueCard, ScorecardCard } from "@/components/targets/sections";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { PermissionDenied } from "@/components/ui/states";
import { getCurrentStaff } from "@/lib/auth/dal";
import { addDays, todayIST } from "@/lib/domain/format";
import { deskKpis, planFromRow, prorate, targetFunnel } from "@/lib/domain/targets";
import { getPipelineKpis, getSalesTarget, getSettings, getTeam } from "@/lib/leads/queries";

export const metadata: Metadata = { title: "Targets" };

export default function TargetsPage(props: PageProps<"/targets">) {
  return (
    <PageContainer>
      <Suspense
        fallback={
          <div>
            <Skeleton className="mb-5 h-8 w-40" />
            <Skeleton className="mb-4 h-72 w-full rounded-2xl" />
            <Skeleton className="h-72 w-full rounded-2xl" />
          </div>
        }
      >
        <Content searchParams={props.searchParams} />
      </Suspense>
    </PageContainer>
  );
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function lastDayOf(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

async function Content({ searchParams }: { searchParams: PageProps<"/targets">["searchParams"] }) {
  const [staff, sp] = await Promise.all([getCurrentStaff(), searchParams]);
  if (staff.role === "salesperson") {
    return <PermissionDenied description="Targets and the team scorecard are for admins and managers. Your own numbers are on your dashboard." />;
  }
  const today = todayIST();
  const monthParam = typeof sp.month === "string" && MONTH.test(sp.month) ? sp.month : today.slice(0, 7);
  const dayParam = typeof sp.day === "string" && DAY.test(sp.day) && sp.day <= today ? sp.day : today;
  const monthStart = `${monthParam}-01`;
  const monthEnd = lastDayOf(monthParam);
  const rangeEnd = monthEnd < today ? monthEnd : today;
  const started = monthStart <= today;

  const [row, settings, team, kpis, day] = await Promise.all([
    getSalesTarget(monthStart),
    getSettings(),
    getTeam(),
    started ? getPipelineKpis(monthStart, rangeEnd) : Promise.resolve(null),
    getPipelineKpis(dayParam, dayParam),
  ]);
  const plan = planFromRow(row);
  const funnel = targetFunnel(plan);
  const daysInMonth = Number(monthEnd.slice(8));
  const elapsed = started ? Number(rangeEnd.slice(8)) : 0;
  const pace = prorate(funnel, elapsed / daysInMonth);
  const desks = kpis ? deskKpis(kpis.desks, plan) : [];
  const names = new Map(team.map((p) => [p.id, p.full_name]));
  const deskOf = new Map(team.map((p) => [p.id, p.desk ?? null]));
  const prevMonth = addDays(monthStart, -1).slice(0, 7);
  const nextMonth = addDays(monthEnd, 1).slice(0, 7);

  return (
    <>
      <PageHeader
        title="Targets"
        description={
          settings?.pipeline_enabled
            ? "Monthly plan, each BDE desk against its KPI, the 100-point scorecard, revenue, and the daily report."
            : "The BDE pipeline is off, so desk numbers will be thin until an admin switches it on from the Team page."
        }
        actions={
          <form className="flex items-center gap-2" action="/targets">
            <a href={`/targets?month=${prevMonth}`} className="rounded-lg px-2 py-1 text-sm text-fg-muted hover:bg-hover hover:text-fg" aria-label="Previous month">
              ‹
            </a>
            <Input type="month" name="month" defaultValue={monthParam} aria-label="Month" className="w-40" />
            <a href={`/targets?month=${nextMonth}`} className="rounded-lg px-2 py-1 text-sm text-fg-muted hover:bg-hover hover:text-fg" aria-label="Next month">
              ›
            </a>
            <Button type="submit" variant="secondary" size="sm">
              Show
            </Button>
          </form>
        }
      />

      <div className="flex flex-col gap-4">
        <PlanForm key={monthStart} month={monthStart} plan={plan} saved={Boolean(row)} canEdit />

        {kpis ? (
          <>
            <ActualVsTarget kpis={kpis} funnel={funnel} pace={pace} elapsed={elapsed} daysInMonth={daysInMonth} />
            <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              <ScorecardCard desks={desks} />
              <RevenueCard kpis={kpis} />
            </div>
            <PeopleTable people={kpis.people} plan={plan} names={names} deskOf={deskOf} />
            <LossReasons reasons={kpis.loss_reasons} />
          </>
        ) : (
          <p className="rounded-2xl border border-line p-6 text-center text-sm text-fg-muted">This month hasn&apos;t started yet.</p>
        )}

        <DailyReport day={dayParam} today={today} month={monthParam} kpis={day} plan={plan} />
      </div>
    </>
  );
}
