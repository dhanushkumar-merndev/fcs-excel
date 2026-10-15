import type { Metadata } from "next";
import { Suspense } from "react";
import { LeadsBrowser } from "@/components/leads/leads-browser";
import { LeadsSkeleton } from "@/components/leads/leads-skeleton";
import { getCurrentStaff } from "@/lib/auth/dal";
import { can } from "@/lib/domain/permissions";
import { parseListState } from "@/lib/leads/filters";
import { getFilterOptions, getSettings, getWorkload, listLeads } from "@/lib/leads/queries";

export const metadata: Metadata = { title: "Leads" };

export default function LeadsPage(props: PageProps<"/leads">) {
  return (
    <Suspense fallback={<LeadsSkeleton />}>
      <LeadsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function LeadsContent({ searchParams }: { searchParams: PageProps<"/leads">["searchParams"] }) {
  const staff = await getCurrentStaff();
  const params = await searchParams;
  const state = parseListState(params);
  const manager = can(staff.role, "assign");
  const [result, options, workload, settings] = await Promise.all([
    listLeads(state),
    getFilterOptions(),
    manager ? getWorkload() : Promise.resolve([]),
    getSettings(),
  ]);
  return (
    <LeadsBrowser
      staff={staff}
      state={state}
      rows={result.rows}
      total={result.total}
      options={options}
      workload={workload}
      canExport={can(staff.role, "export", { salespersonExportEnabled: settings?.salesperson_export_enabled })}
    />
  );
}
