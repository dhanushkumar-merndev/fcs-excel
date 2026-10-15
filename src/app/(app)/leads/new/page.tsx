import type { Metadata } from "next";
import { Suspense } from "react";
import { NewLeadForm } from "@/components/leads/new-lead-form";
import { PageContainer, PageHeader } from "@/components/shell/page";
import { Skeleton } from "@/components/ui/card";
import { PermissionDenied } from "@/components/ui/states";
import { getCurrentStaff } from "@/lib/auth/dal";
import { can } from "@/lib/domain/permissions";
import { getWorkload } from "@/lib/leads/queries";

export const metadata: Metadata = { title: "New lead" };

export default function NewLeadPage() {
  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title="New lead" description="Add an enquiry that came in by phone, WhatsApp, referral or walk-in." />
      <Suspense fallback={<Skeleton className="h-[480px] w-full rounded-2xl" />}>
        <Content />
      </Suspense>
    </PageContainer>
  );
}

async function Content() {
  const staff = await getCurrentStaff();
  if (!can(staff.role, "createLead")) {
    return <PermissionDenied description="Only admins and managers can add leads manually." />;
  }
  const workload = await getWorkload();
  return <NewLeadForm workload={workload} />;
}
