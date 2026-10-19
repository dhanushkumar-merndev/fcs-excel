import "server-only";
import { connection } from "next/server";
import { cache } from "react";
import { getCurrentStaff } from "@/lib/auth/dal";
import { can, navFor } from "@/lib/domain/permissions";
import { SHEET_SYNC_COLUMNS, type SheetSyncStatus } from "@/lib/domain/sheet-sync";
import { createClient } from "@/lib/supabase/server";
import { BrandMark } from "./brand";
import { BottomNav } from "./bottom-nav";
import { GlobalSearch } from "./global-search";
import { NotificationBell } from "./notification-bell";
import { SheetSyncStatusChip } from "./sheet-sync-status";
import { Sidebar } from "./sidebar";

const loadChrome = cache(async () => {
  // Request time, never prerendered: the overdue count compares against "now".
  await connection();
  const staff = await getCurrentStaff();
  const supabase = await createClient();
  let overdue = supabase
    .from("follow_ups")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lt("due_at", new Date().toISOString());
  if (staff.role === "salesperson") overdue = overdue.eq("assignee_id", staff.id);
  const [settings, overdueRes, unreadRes, syncRes] = await Promise.all([
    supabase.from("business_settings").select("business_name").eq("id", 1).maybeSingle(),
    overdue,
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    supabase.from("sheet_sync").select(SHEET_SYNC_COLUMNS).eq("id", 1).maybeSingle(),
  ]);
  return {
    staff,
    businessName: settings.data?.business_name ?? "FCS",
    overdue: overdueRes.count ?? 0,
    unread: unreadRes.count ?? 0,
    sheetSync: (syncRes.data as SheetSyncStatus | null) ?? null,
  };
});

export async function SidebarSlot() {
  const { staff, businessName, overdue } = await loadChrome();
  return (
    <Sidebar
      items={navFor(staff.role)}
      businessName={businessName}
      overdueCount={overdue}
      user={{ fullName: staff.fullName, username: staff.username, role: staff.role }}
    />
  );
}

export async function TopbarSlot() {
  const { staff, businessName, unread, sheetSync } = await loadChrome();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-canvas/95 px-4 backdrop-blur md:h-[68px] md:border-b-0 md:px-6 md:pt-3 2xl:px-8">
      <span className="flex min-w-0 items-center gap-2.5 md:hidden">
        <BrandMark className="size-7 shrink-0" />
        <span className="truncate text-[15px] font-semibold tracking-tight">{businessName}</span>
      </span>
      <div className="hidden min-w-0 flex-1 md:block">
        <GlobalSearch />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <SheetSyncStatusChip initial={sheetSync} canRun={can(staff.role, "import")} />
        <NotificationBell userId={staff.id} initialUnread={unread} />
      </div>
    </header>
  );
}

export async function BottomNavSlot() {
  const { overdue } = await loadChrome();
  return <BottomNav overdueCount={overdue} />;
}

export function SidebarFallback() {
  return <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 border-r border-line bg-sidebar md:block" />;
}

export function TopbarFallback() {
  return <div className="h-14 border-b border-line md:h-[68px] md:border-b-0" />;
}
