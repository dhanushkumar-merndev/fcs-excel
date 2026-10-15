import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportView } from "@/components/reports/report-view";
import { PageContainer } from "@/components/shell/page";
import { Skeleton } from "@/components/ui/card";
import { getCurrentStaff } from "@/lib/auth/dal";
import { can } from "@/lib/domain/permissions";
import { toRpcFilters } from "@/lib/leads/filters";
import { getFilterOptions, getSettings, getWorkload } from "@/lib/leads/queries";
import { cohortFilters, parseReportParams, type ReportData } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage(props: PageProps<"/reports">) {
  return (
    <PageContainer>
      <Suspense
        fallback={
          <div>
            <Skeleton className="mb-5 h-8 w-40" />
            <Skeleton className="mb-5 h-11 w-full rounded-xl" />
            <div className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-72 rounded-2xl" />
              <Skeleton className="h-72 rounded-2xl" />
            </div>
          </div>
        }
      >
        <Content searchParams={props.searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/reports">["searchParams"] }) {
  const [staff, sp] = await Promise.all([getCurrentStaff(), searchParams]);
  const params = parseReportParams(sp);
  const manager = staff.role !== "salesperson";
  const supabase = await createClient();
  const [report, options, workload, settings] = await Promise.all([
    supabase.rpc("report_overview", { p_filters: toRpcFilters(cohortFilters(params)) }),
    getFilterOptions(),
    manager ? getWorkload() : Promise.resolve([]),
    getSettings(),
  ]);
  if (report.error) throw new Error(report.error.message);
  return (
    <ReportView
      data={report.data as ReportData}
      params={params}
      scope={staff.role === "admin" ? "Business-wide" : staff.role === "manager" ? "Team-wide" : "Your performance"}
      manager={manager}
      options={options}
      workload={workload}
      canExport={can(staff.role, "export", { salespersonExportEnabled: settings?.salesperson_export_enabled })}
    />
  );
}
