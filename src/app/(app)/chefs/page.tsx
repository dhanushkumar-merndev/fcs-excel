import type { Metadata } from "next";
import { Suspense } from "react";
import { ChefDirectoryView } from "@/components/chefs/chef-directory";
import { PageContainer, PageHeader } from "@/components/shell/page";
import { Skeleton } from "@/components/ui/card";
import { ErrorState, PermissionDenied } from "@/components/ui/states";
import { getCurrentStaff } from "@/lib/auth/dal";
import { can } from "@/lib/domain/permissions";
import { fetchChefDirectory } from "@/lib/chefpy/fetch";

export const metadata: Metadata = { title: "Chefs" };

export default function ChefsPage() {
  return (
    <PageContainer>
      <PageHeader title="Chefs" description="Chefs registered on Chefpy and whether each one is booked or available right now." />
      <Suspense
        fallback={
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-24 rounded-2xl" />
              ))}
            </div>
            <Skeleton className="mb-4 h-10 w-full max-w-md rounded-xl" />
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="mb-2 h-24 w-full rounded-2xl" />
            ))}
          </>
        }
      >
        <Content />
      </Suspense>
    </PageContainer>
  );
}

const FAILURES = {
  unconfigured: {
    title: "Chefpy isn't connected yet",
    description: "Set CHEFPY_API_URL and CHEFPY_INTEGRATION_TOKEN on the server, then reload this page.",
  },
  unauthorized: {
    title: "Chefpy refused the connection",
    description: "CHEFPY_INTEGRATION_TOKEN here doesn't match the token configured in Chefpy.",
  },
  unreachable: {
    title: "Couldn't reach Chefpy",
    description: "The chef app didn't answer. Check that it is running and that CHEFPY_API_URL is correct.",
  },
  upstream: {
    title: "Chefpy couldn't load its chefs",
    description: "The chef app is running but its chef list failed. Try again in a minute; if it keeps failing, check Chefpy's database.",
  },
  upstreamUnconfigured: {
    title: "Chefpy's side isn't set up yet",
    description: "Set CHEFPY_INTEGRATION_TOKEN and the Supabase keys on the Chefpy server.",
  },
  invalid: {
    title: "Chefpy sent data this page can't read",
    description: "Both apps may need updating to the same version.",
  },
} as const;

async function Content() {
  const staff = await getCurrentStaff();
  if (!can(staff.role, "viewChefs")) return <PermissionDenied description="Only admins and managers can see Chefpy chefs." />;
  const result = await fetchChefDirectory();
  if (!result.ok) {
    const f = FAILURES[result.reason];
    return (
      <ErrorState
        title={f.title}
        description={
          <>
            {f.description}
            {result.detail && staff.role === "admin" ? <span className="mt-1 block text-xs text-fg-subtle">{result.detail}</span> : null}
          </>
        }
      />
    );
  }
  return <ChefDirectoryView directory={result.data} />;
}
