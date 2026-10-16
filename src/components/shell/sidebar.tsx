"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavKey } from "@/lib/domain/permissions";
import { useLocalStorageState } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { BrandMark } from "./brand";
import { NAV, isActivePath } from "./nav-items";
import { UserMenu } from "./user-menu";

export function Sidebar({
  items,
  businessName,
  overdueCount,
  user,
}: {
  items: NavKey[];
  businessName: string;
  overdueCount: number;
  user: { fullName: string; username: string; role: string };
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useLocalStorageState("sidebar-collapsed", false);

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-sidebar transition-[width] duration-200 md:flex",
        collapsed ? "w-[68px]" : "w-[248px]",
      )}
      aria-label="Main navigation"
    >
      <div className={cn("flex h-14 items-center gap-2 px-3", collapsed ? "justify-center" : "justify-between")}>
        {collapsed ? null : (
          <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-hover">
            <BrandMark className="size-7 shrink-0" />
            <span className="truncate text-[15px] font-semibold tracking-tight">{businessName}</span>
          </Link>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-hover hover:text-fg"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
        >
          {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2">
        {items.map((key) => {
          const item = NAV[key];
          const active = isActivePath(pathname, item.href);
          const Icon = item.icon;
          const badge = key === "follow-ups" && overdueCount > 0 ? overdueCount : null;
          return (
            <Link
              key={key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              className={cn(
                "group relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors",
                active ? "bg-active font-medium text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
                collapsed && "justify-center px-0",
              )}
            >
              <Icon className="size-[18px] shrink-0" />
              {collapsed ? null : <span className="truncate">{item.label}</span>}
              {badge ? (
                <span
                  className={cn(
                    "tabular flex h-5 min-w-5 items-center justify-center rounded-full bg-tint-red px-1.5 text-[11px] font-semibold text-tint-red-fg",
                    collapsed ? "absolute top-1 right-1.5 h-4 min-w-4 px-1 text-[10px]" : "ml-auto",
                  )}
                  aria-label={`${badge} overdue`}
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line p-2">
        <UserMenu user={user} collapsed={collapsed} />
      </div>
    </aside>
  );
}
