import type { Metadata } from "next";
import { Suspense } from "react";
import { WorkloadTable } from "@/components/dashboard/manager-dashboard";
import { PageContainer, PageHeader } from "@/components/shell/page";
import { TeamManager, type Member } from "@/components/team/team-manager";
import { Card, CardBody, CardHeader, Skeleton } from "@/components/ui/card";
import { PermissionDenied } from "@/components/ui/states";
import { getCurrentStaff } from "@/lib/auth/dal";
import { getTeam, getWorkload } from "@/lib/leads/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Team" };

export default function TeamPage() {
  return (
    <PageContainer>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-2xl" />}>
        <Content />
      </Suspense>
    </PageContainer>
  );
}

async function Content() {
  const staff = await getCurrentStaff();
  if (staff.role === "salesperson") return <PermissionDenied description="Only admins and managers can see the team page." />;
  const [team, workload] = await Promise.all([getTeam(), getWorkload()]);

  if (staff.role === "manager") {
    return (
      <>
        <PageHeader title="Team" description="Workload across the team. Only an admin can invite people or change roles." />
        <Card>
          <CardHeader title="Workload" />
          <CardBody className="px-2 sm:px-3">
            <WorkloadTable rows={workload} />
          </CardBody>
        </Card>
      </>
    );
  }

  // Sign-in status comes from Auth (admin only).
  const signIns = new Map<string, string | null>();
  try {
    const { data } = await createAdminClient().auth.admin.listUsers({ perPage: 1000 });
    for (const u of data?.users ?? []) signIns.set(u.id, u.last_sign_in_at ?? null);
  } catch {
    // Without the secret key the page still works; sign-in status just isn't shown.
  }
  const members: Member[] = team.map((p) => {
    const w = workload.find((x) => x.id === p.id);
    return {
      ...p,
      last_sign_in_at: signIns.get(p.id) ?? null,
      open_leads: w?.open_leads ?? 0,
      overdue_follow_ups: w?.overdue_follow_ups ?? 0,
    };
  });
  return <TeamManager members={members} currentUserId={staff.id} />;
}
