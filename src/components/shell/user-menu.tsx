"use client";

import { ChevronsUpDown, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { ROLE_LABELS } from "@/lib/domain/labels";
import { cn, initials } from "@/lib/utils";
import { useTheme, type ThemePref } from "./theme";

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-active text-xs font-semibold text-fg",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export function signOutNow() {
  // Full page load on purpose: clears all client state kept across routes.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/auth/signout?reason=signed_out";
}

export function UserMenu({
  user,
  collapsed,
}: {
  user: { fullName: string; email: string; role: string };
  collapsed?: boolean;
}) {
  const { pref, setPref } = useTheme();
  return (
    <Menu>
      <MenuTrigger
        className={cn(
          "flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left hover:bg-hover",
          collapsed && "justify-center",
        )}
        aria-label="Account menu"
      >
        <Avatar name={user.fullName} />
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{user.fullName}</span>
              <span className="block truncate text-xs text-fg-subtle">{ROLE_LABELS[user.role]}</span>
            </span>
            <ChevronsUpDown className="size-4 text-fg-subtle" />
          </>
        )}
      </MenuTrigger>
      <MenuContent align={collapsed ? "start" : "end"} side="top" className="w-60">
        <MenuLabel className="truncate">{user.email}</MenuLabel>
        <MenuSeparator />
        <MenuLabel>Theme</MenuLabel>
        <MenuRadioGroup value={pref} onValueChange={(v) => setPref(v as ThemePref)}>
          <MenuRadioItem value="light">
            <Sun className="size-4 text-fg-muted" /> Light
          </MenuRadioItem>
          <MenuRadioItem value="dark">
            <Moon className="size-4 text-fg-muted" /> Dark
          </MenuRadioItem>
          <MenuRadioItem value="system">
            <Monitor className="size-4 text-fg-muted" /> System
          </MenuRadioItem>
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem icon={<LogOut />} onSelect={signOutNow}>
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
