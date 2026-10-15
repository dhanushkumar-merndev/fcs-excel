"use client";

import { DropdownMenu } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({ className, align = "end", ...props }: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-50 min-w-48 rounded-xl border border-line bg-surface p-1 text-sm shadow-soft outline-none",
          className,
        )}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

export function MenuItem({
  className,
  icon,
  tone,
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.Item> & { icon?: ReactNode; tone?: "danger" }) {
  return (
    <DropdownMenu.Item
      className={cn(
        "flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 text-fg outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-hover data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-fg-muted",
        tone === "danger" && "text-danger [&_svg]:text-danger",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </DropdownMenu.Item>
  );
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenu.Label>) {
  return <DropdownMenu.Label className={cn("px-2.5 pt-2 pb-1 text-xs font-medium text-fg-subtle", className)} {...props} />;
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-line" />;
}

export const MenuRadioGroup = DropdownMenu.RadioGroup;

export function MenuRadioItem({ className, children, ...props }: ComponentProps<typeof DropdownMenu.RadioItem>) {
  return (
    <DropdownMenu.RadioItem
      className={cn(
        "relative flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-lg pr-2.5 pl-8 outline-none data-[highlighted]:bg-hover",
        className,
      )}
      {...props}
    >
      <DropdownMenu.ItemIndicator className="absolute left-2.5 size-1.5 rounded-full bg-fg" />
      {children}
    </DropdownMenu.RadioItem>
  );
}
