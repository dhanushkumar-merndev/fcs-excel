import type { Metadata } from "next";
import { Suspense } from "react";
import { ManagerDashboard } from "@/components/dashboard/manager-dashboard";
import { SalesHome } from "@/components/dashboard/sales-home";
import { PageContainer } from "@/components/shell/page";
import { Skeleton } from "@/components/ui/card";
import { getCurrentStaff } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <PageContainer>
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard />
      </Suspense>
    </PageContainer>
  );
}

async function Dashboard() {
  const staff = await getCurrentStaff();
  return staff.role === "salesperson" ? <SalesHome staff={staff} /> : <ManagerDashboard staff={staff} />;
}

function DashboardSkeleton() {
  return (
    <div>
      <Skeleton className="mb-2 h-8 w-56" />
      <Skeleton className="mb-6 h-5 w-72" />
      <div className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-80 w-full rounded-2xl" />
      <span className="sr-only" role="status">Loading dashboard…</span>
    </div>
  );
}
