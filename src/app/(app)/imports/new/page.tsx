import type { Metadata } from "next";
import { Suspense } from "react";
import { ImportWizard } from "@/components/imports/import-wizard";
import { PageContainer } from "@/components/shell/page";
import { Skeleton } from "@/components/ui/card";
import { PermissionDenied } from "@/components/ui/states";
import { getCurrentStaff } from "@/lib/auth/dal";
import { can } from "@/lib/domain/permissions";
import { getWorkload } from "@/lib/leads/queries";

export const metadata: Metadata = { title: "Import leads" };

export default function NewImportPage() {
  return (
    <PageContainer>
      <Suspense fallback={<Skeleton className="h-[520px] w-full rounded-2xl" />}>
        <Content />
      </Suspense>
    </PageContainer>
  );
}

async function Content() {
  const staff = await getCurrentStaff();
  if (!can(staff.role, "import")) return <PermissionDenied description="Only admins and managers can import leads." />;
  const workload = await getWorkload();
  return <ImportWizard workload={workload} />;
}
