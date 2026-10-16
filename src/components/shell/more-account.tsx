"use client";

import { ChevronRight, KeyRound, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { ROLE_LABELS } from "@/lib/domain/labels";
import { cn } from "@/lib/utils";
import { ChangePasswordSheet } from "./change-password-sheet";
import { useTheme, type ThemePref } from "./theme";
import { Avatar, signOutNow } from "./user-menu";

export function MoreAccount({ user }: { user: { fullName: string; username: string; role: string } }) {
  const { pref, setPref } = useTheme();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const options: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "dark", label: "Dark", Icon: Moon },
    { value: "system", label: "System", Icon: Monitor },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
        <Avatar name={user.fullName} className="size-10" />
        <div className="min-w-0">
          <p className="truncate font-medium">{user.fullName}</p>
          <p className="truncate text-[13px] text-fg-muted">
            @{user.username} · {ROLE_LABELS[user.role]}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setPasswordOpen(true)}
        className="flex h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 text-left hover:bg-hover"
      >
        <KeyRound className="size-[18px] text-fg-muted" />
        <span className="flex-1 text-[15px]">Change password</span>
        <ChevronRight className="size-4 text-fg-subtle" />
      </button>
      <ChangePasswordSheet open={passwordOpen} onOpenChange={setPasswordOpen} />
      <div className="rounded-2xl border border-line bg-surface p-4">
        <p className="mb-2.5 text-[13px] font-medium">Appearance</p>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
          {options.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={pref === value}
              onClick={() => setPref(value)}
              className={cn(
                "flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-[13px]",
                pref === value ? "border-fg ring-1 ring-fg" : "border-line hover:bg-hover",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={signOutNow}
        className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-line bg-surface text-[15px] text-danger hover:bg-hover"
      >
        <LogOut className="size-4" /> Sign out
      </button>
    </div>
  );
}
