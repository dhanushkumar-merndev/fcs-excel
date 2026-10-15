import Link from "next/link";
import { PageContainer } from "@/components/shell/page";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export default function NotFound() {
  return (
    <PageContainer>
      <EmptyState
        title="Not found or no access"
        description="This record doesn't exist, or it isn't assigned to you."
        action={
          <Link href="/leads" className={buttonVariants({ variant: "secondary" })}>
            Back to leads
          </Link>
        }
      />
    </PageContainer>
  );
}
