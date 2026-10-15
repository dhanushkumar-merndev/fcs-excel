import "server-only";
import Link from "next/link";
import { BarList } from "@/components/charts/bar-list";
import { ImportStatusBadge } from "@/components/imports/status";
import { Avatar } from "@/components/shell/user-menu";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { addDays, formatDateTime, todayIST } from "@/lib/domain/format";
import { OPEN_STAGES, STAGES, stageLabel } from "@/lib/domain/stages";
import type { ImportBatchRow, Staff, WorkloadRow } from "@/lib/domain/types";
import { leadsHref } from "@/lib/leads/filters";
import { getWorkload } from "@/lib/leads/queries";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "./stat-card";

export async function ManagerDashboard({ staff }: { staff: Staff }) {
  const supabase = await createClient();
  const today = todayIST();
  const [summaryRes, workload, importsRes] = await Promise.all([
    supabase.rpc("dashboard_summary"),
    getWorkload(),
    supabase
      .from("import_batches")
      .select("id, file_name, created_at, status, created_count, skipped_count, invalid_count, failed_count, pending_count, review_count, last_heartbeat_at, uploader:profiles!import_batches_uploaded_by_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  const s = (summaryRes.data ?? {}) as Record<string, number> & { by_stage?: Record<string, number> };
  const byStage = s.by_stage ?? {};
  const imports = (importsRes.data ?? []) as unknown as (ImportBatchRow & { uploader: { full_name: string } | null })[];
  const last30 = addDays(today, -29);

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight md:text-2xl">Dashboard</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {staff.role === "admin" ? "Business-wide" : "Team-wide"} view · numbers open the matching records.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/imports/new" className={buttonVariants({ variant: "secondary" })}>
            Import leads
          </Link>
          <Link href="/leads?view=unassigned" className={buttonVariants()}>
            Assign leads
          </Link>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatCard label="New today" value={s.new_today ?? 0} href={leadsHref({ imported_from: today })} hint="Added to CRM today" />
        <StatCard label="Unassigned" value={s.unassigned_open ?? 0} href="/leads?view=unassigned" tone="amber" hint="Open, no owner yet" />
        <StatCard label="Overdue follow-ups" value={s.overdue_follow_ups ?? 0} href="/follow-ups?tab=overdue&person=all" tone="red" />
        <StatCard label="Awaiting first call" value={s.awaiting_first_contact ?? 0} href="/leads?view=awaiting_contact" />
        <StatCard label="New in last 7 days" value={s.new_7d ?? 0} href={leadsHref({ imported_from: addDays(today, -6) })} />
        <StatCard label="Booked · last 30 days" value={s.booked_30d ?? 0} href={leadsHref({ stage: ["booked"], closed_from: last30 })} tone="green" hint="By date closed" />
        <StatCard label="Lost · last 30 days" value={s.lost_30d ?? 0} href={leadsHref({ stage: ["lost", "unqualified"], closed_from: last30 })} hint="Lost + unqualified" />
        <StatCard label="Needs review" value={s.needs_review ?? 0} href="/leads?view=needs_review" tone="amber" hint="Date or details" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Active enquiries by stage" description={`${(s.open ?? 0).toLocaleString("en-IN")} open enquiries`} />
          <CardBody>
            <BarList
              valueLabel="leads"
              items={OPEN_STAGES.map((stage) => ({
                key: stage,
                label: stageLabel(stage),
                value: byStage[stage] ?? 0,
                href: leadsHref({ stage: [stage] }),
              }))}
            />
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-[13px] text-fg-muted">
              {STAGES.filter((st) => !OPEN_STAGES.includes(st.value)).map((st) => (
                <Link key={st.value} href={leadsHref({ stage: [st.value] })} className="hover:text-fg hover:underline">
                  {st.label}: <span className="tabular font-medium text-fg">{(byStage[st.value] ?? 0).toLocaleString("en-IN")}</span>
                </Link>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Team workload" description="Open leads and follow-ups per person right now." />
          <CardBody className="px-2 sm:px-3">
            <WorkloadTable rows={workload} />
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent imports"
            action={
              <Link href="/imports" className="text-[13px] text-fg-muted hover:text-fg hover:underline">
                All imports
              </Link>
            }
          />
          <CardBody>
            {imports.length === 0 ? (
              <p className="text-sm text-fg-muted">
                No imports yet. <Link href="/imports/new" className="underline">Import your first file</Link>.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {imports.map((b) => {
                  const issues = b.invalid_count + b.failed_count + b.review_count;
                  return (
                    <li key={b.id}>
                      <Link href={`/imports/${b.id}`} className="flex flex-col gap-1 py-2.5 hover:opacity-80 sm:flex-row sm:items-center sm:justify-between">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{b.file_name}</span>
                          <span className="text-xs text-fg-subtle">
                            {b.uploader?.full_name ?? "Someone"} · {formatDateTime(b.created_at)}
                          </span>
                        </span>
                        <span className="flex items-center gap-3 text-[13px] text-fg-muted">
                          <span className="tabular">
                            {b.created_count} created
                            {issues ? <span className="text-tint-amber-fg"> · {issues} to check</span> : null}
                          </span>
                          <ImportStatusBadge batch={b} />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export function WorkloadTable({ rows }: { rows: WorkloadRow[] }) {
  if (!rows.length) return <p className="px-2 text-sm text-fg-muted">No active team members.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-fg-muted">
          <tr>
            <th className="px-2 py-1.5 font-medium">Person</th>
            <th className="px-2 py-1.5 text-right font-medium">Open</th>
            <th className="px-2 py-1.5 text-right font-medium">Overdue</th>
            <th className="px-2 py-1.5 text-right font-medium">Due today</th>
            <th className="px-2 py-1.5 text-right font-medium">New (7d)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id} className="border-t border-line">
              <td className="px-2 py-2">
                <span className="flex items-center gap-2">
                  <Avatar name={w.full_name} className="size-7 text-[11px]" />
                  <span className="truncate">{w.full_name}</span>
                </span>
              </td>
              <td className="tabular px-2 py-2 text-right">
                <Link className="hover:underline" href={leadsHref({ owner: [w.id], stage_group: "open" })}>
                  {w.open_leads}
                </Link>
              </td>
              <td className="tabular px-2 py-2 text-right">
                <Link className={w.overdue_follow_ups > 0 ? "font-medium text-danger hover:underline" : "hover:underline"} href={`/follow-ups?tab=overdue&person=${w.id}`}>
                  {w.overdue_follow_ups}
                </Link>
              </td>
              <td className="tabular px-2 py-2 text-right">
                <Link className="hover:underline" href={`/follow-ups?tab=today&person=${w.id}`}>
                  {w.due_today}
                </Link>
              </td>
              <td className="tabular px-2 py-2 text-right text-fg-muted">{w.assigned_last_7_days}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
