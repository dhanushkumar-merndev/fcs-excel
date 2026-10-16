import { PageContainer } from "@/components/shell/page";
import { Skeleton } from "@/components/ui/card";

export function LeadDetailSkeleton() {
  return (
    <PageContainer>
      <Skeleton className="mb-4 h-5 w-20" />
      <Skeleton className="mb-2 h-8 w-64" />
      <Skeleton className="mb-6 h-5 w-48" />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px] 2xl:grid-cols-[1fr_400px]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-44 w-full rounded-2xl" />
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
        <Skeleton className="hidden h-96 rounded-2xl lg:block" />
      </div>
      <span className="sr-only" role="status">Loading lead…</span>
    </PageContainer>
  );
}
