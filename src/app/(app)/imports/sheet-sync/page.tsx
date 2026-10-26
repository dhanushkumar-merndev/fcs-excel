import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SheetSyncSettingsForm } from "@/components/imports/sheet-sync-settings";
import { PageContainer } from "@/components/shell/page";
import { Skeleton } from "@/components/ui/card";
import { PermissionDenied } from "@/components/ui/states";
import { getCurrentStaff } from "@/lib/auth/dal";
import { can } from "@/lib/domain/permissions";
import { SHEET_SYNC_COLUMNS, SHEET_SYNC_TAB_COLUMNS, type SheetSyncSettings, type SheetSyncStatus, type SheetSyncTab } from "@/lib/domain/sheet-sync";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Google Sheet sync" };

export default function SheetSyncPage() {
  return (
    <PageContainer>
      <div className="mb-5 flex items-center gap-3">
        <Link href="/imports" className="flex size-9 items-center justify-center rounded-full text-fg-muted hover:bg-hover hover:text-fg" aria-label="Back to imports">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight md:text-2xl">Google Sheet sync</h1>
          <p className="text-sm text-fg-muted">New rows in your Meta leads sheet become leads automatically, through the same cleaning and duplicate checks as an import.</p>
        </div>
      </div>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-2xl" />}>
        <Content />
      </Suspense>
    </PageContainer>
  );
}

async function Content() {
  const staff = await getCurrentStaff();
  if (!can(staff.role, "import")) return <PermissionDenied description="Only admins and managers can set up the Google Sheet sync." />;
  const supabase = await createClient();
  const [settings, status, tabs] = await Promise.all([
    supabase.rpc("sheet_sync_settings"),
    supabase.from("sheet_sync").select(SHEET_SYNC_COLUMNS).eq("id", 1).maybeSingle(),
    supabase.from("sheet_sync_tabs").select(SHEET_SYNC_TAB_COLUMNS).order("position"),
  ]);
  if (settings.error) throw new Error(settings.error.message);
  return (
    <SheetSyncSettingsForm
      settings={settings.data as SheetSyncSettings}
      status={(status.data as SheetSyncStatus | null) ?? null}
      tabStatus={(tabs.data as SheetSyncTab[] | null) ?? []}
    />
  );
}
