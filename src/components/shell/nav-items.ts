import {
  CalendarClock,
  ChartColumn,
  FileSpreadsheet,
  LayoutDashboard,
  Settings,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { NavKey } from "@/lib/domain/permissions";

export const NAV: Record<NavKey, { href: string; label: string; icon: LucideIcon }> = {
  dashboard: { href: "/", label: "Dashboard", icon: LayoutDashboard },
  leads: { href: "/leads", label: "Leads", icon: Users },
  "follow-ups": { href: "/follow-ups", label: "Follow-ups", icon: CalendarClock },
  imports: { href: "/imports", label: "Imports", icon: FileSpreadsheet },
  reports: { href: "/reports", label: "Reports", icon: ChartColumn },
  team: { href: "/team", label: "Team", icon: UsersRound },
  settings: { href: "/settings", label: "Settings", icon: Settings },
};

export function isActivePath(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
