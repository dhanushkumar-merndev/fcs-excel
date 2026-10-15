import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer, PageHeader } from "@/components/shell/page";
import { SettingsForm } from "@/components/team/settings-form";
import { Skeleton } from "@/components/ui/card";
import { PermissionDenied } from "@/components/ui/states";
import { getCurrentStaff } from "@/lib/auth/dal";
import { getSettings } from "@/lib/leads/queries";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title="Settings" description="Business-wide settings. Changes are recorded in the audit log." />
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-2xl" />}>
        <Content />
      </Suspense>
    </PageContainer>
  );
}

async function Content() {
  const staff = await getCurrentStaff();
  if (staff.role !== "admin") return <PermissionDenied description="Only an admin can change business settings." />;
  return <SettingsForm settings={await getSettings()} />;
}
