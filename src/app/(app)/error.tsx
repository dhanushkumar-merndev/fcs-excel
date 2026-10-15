"use client";

import { useEffect } from "react";
import { PageContainer } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <PageContainer>
      <ErrorState
        description="This page couldn't load. Check your connection — nothing you saved was lost."
        action={<Button onClick={() => retry()}>Try again</Button>}
      />
    </PageContainer>
  );
}
