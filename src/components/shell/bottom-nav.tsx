"use client";

import { CalendarClock, Ellipsis, House, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActivePath } from "./nav-items";

const ITEMS = [
  { href: "/", label: "Home", icon: House },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/follow-ups", label: "Follow-ups", icon: CalendarClock },
  { href: "/more", label: "More", icon: Ellipsis },
];

const MORE_PATHS = ["/more", "/imports", "/reports", "/team", "/settings", "/notifications"];

export function BottomNav({ overdueCount }: { overdueCount: number }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main navigation"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas/95 backdrop-blur md:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {ITEMS.map((item) => {
          const active =
            item.href === "/more" ? MORE_PATHS.some((p) => isActivePath(pathname, p)) : isActivePath(pathname, item.href);
          const Icon = item.icon;
          const badge = item.href === "/follow-ups" && overdueCount > 0 ? overdueCount : null;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                  active ? "text-fg" : "text-fg-subtle",
                )}
              >
                <span className={cn("flex h-7 w-12 items-center justify-center rounded-full", active && "bg-active")}>
                  <Icon className="size-[20px]" />
                </span>
                {item.label}
                {badge ? (
                  <span className="tabular absolute top-2 left-1/2 ml-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white dark:text-[#1a0d0b]">
                    {badge > 99 ? "99+" : badge}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
