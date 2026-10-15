import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LeadDetailView } from "@/components/leads/detail/lead-detail";
import { LeadDetailSkeleton } from "@/components/leads/detail/skeleton";
import { getCurrentStaff } from "@/lib/auth/dal";
import { can } from "@/lib/domain/permissions";
import { getLeadDetail, getSettings, getWorkload } from "@/lib/leads/queries";

export const metadata: Metadata = { title: "Lead" };

export default function LeadPage(props: PageProps<"/leads/[id]">) {
  return (
    <Suspense fallback={<LeadDetailSkeleton />}>
      <LeadContent params={props.params} />
    </Suspense>
  );
}

async function LeadContent({ params }: { params: PageProps<"/leads/[id]">["params"] }) {
  const [{ id }, staff] = await Promise.all([params, getCurrentStaff()]);
  const manager = can(staff.role, "assign");
  const [detail, settings, workload] = await Promise.all([
    getLeadDetail(id),
    getSettings(),
    manager ? getWorkload() : Promise.resolve([]),
  ]);
  // Missing and not-permitted look the same, so IDs can't be probed.
  if (!detail) notFound();
  return <LeadDetailView detail={detail} staff={staff} settings={settings} workload={workload} />;
}
