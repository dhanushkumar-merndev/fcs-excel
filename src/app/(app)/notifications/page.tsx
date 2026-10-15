import type { Metadata } from "next";
import { Suspense } from "react";
import { NotificationsList } from "@/components/shell/notifications-list";
import { PageContainer, PageHeader } from "@/components/shell/page";
import { Skeleton } from "@/components/ui/card";
import { getCurrentStaff } from "@/lib/auth/dal";
import type { NotificationRow } from "@/lib/domain/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title="Notifications" description="Assignments, follow-up reminders and import results. Unread items stay until you open them." />
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-2xl" />}>
        <Content />
      </Suspense>
    </PageContainer>
  );
}

async function Content() {
  await getCurrentStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, title, body, link, lead_id, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return <NotificationsList items={(data ?? []) as NotificationRow[]} />;
}
