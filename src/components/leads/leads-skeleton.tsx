import { PageContainer } from "@/components/shell/page";
import { Skeleton } from "@/components/ui/card";

export function LeadsSkeleton() {
  return (
    <PageContainer>
      <div className="mb-5 flex items-end justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="hidden h-10 w-64 rounded-full sm:block" />
      </div>
      <div className="mb-4 flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-28 shrink-0 rounded-full" />
        ))}
      </div>
      <Skeleton className="mb-4 h-11 w-full rounded-xl" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl md:h-12" />
        ))}
      </div>
      <span className="sr-only" role="status">Loading leads…</span>
    </PageContainer>
  );
}
