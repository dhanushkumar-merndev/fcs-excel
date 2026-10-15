import "server-only";
import { cache } from "react";
import { getCurrentStaff } from "@/lib/auth/dal";
import { navFor } from "@/lib/domain/permissions";
import { createClient } from "@/lib/supabase/server";
import { BrandMark } from "./brand";
import { BottomNav } from "./bottom-nav";
import { GlobalSearch } from "./global-search";
import { NotificationBell } from "./notification-bell";
import { Sidebar } from "./sidebar";

const loadChrome = cache(async () => {
  const staff = await getCurrentStaff();
  const supabase = await createClient();
  let overdue = supabase
    .from("follow_ups")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lt("due_at", new Date().toISOString());
  if (staff.role === "salesperson") overdue = overdue.eq("assignee_id", staff.id);
  const [settings, overdueRes, unreadRes] = await Promise.all([
    supabase.from("business_settings").select("business_name").eq("id", 1).maybeSingle(),
    overdue,
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  return {
    staff,
    businessName: settings.data?.business_name ?? "FCS",
    overdue: overdueRes.count ?? 0,
    unread: unreadRes.count ?? 0,
  };
});

export async function SidebarSlot() {
  const { staff, businessName, overdue } = await loadChrome();
  return (
    <Sidebar
      items={navFor(staff.role)}
      businessName={businessName}
      overdueCount={overdue}
      user={{ fullName: staff.fullName, email: staff.email, role: staff.role }}
    />
  );
}

export async function TopbarSlot() {
  const { staff, businessName, unread } = await loadChrome();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-canvas/95 px-4 backdrop-blur md:border-b-0 md:px-6">
      <span className="flex min-w-0 items-center gap-2.5 md:hidden">
        <BrandMark className="size-7 shrink-0" />
        <span className="truncate text-[15px] font-semibold tracking-tight">{businessName}</span>
      </span>
      <div className="hidden min-w-0 flex-1 md:block">
        <GlobalSearch />
      </div>
      <div className="ml-auto flex items-center gap-1">
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
  return <div className="h-14 border-b border-line md:border-b-0" />;
}
