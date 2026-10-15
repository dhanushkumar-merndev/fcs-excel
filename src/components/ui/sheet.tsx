"use client";

import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import type { ReactNode } from "react";
import { Drawer } from "vaul";
import { useIsMobile } from "@/lib/hooks";
import { cn } from "@/lib/utils";

type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Desktop width */
  size?: "sm" | "md" | "lg" | "xl";
};

const sizes = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

/**
 * Bottom sheet on phones (thumb-reachable, swipe to dismiss), centered dialog on larger screens.
 * The footer stays pinned so primary actions are always visible above the keyboard.
 */
export function Sheet({ open, onOpenChange, title, description, children, footer, size = "md" }: SheetProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-overlay" />
          <Drawer.Content
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border-t border-line bg-surface outline-none"
            {...(description ? {} : { "aria-describedby": undefined })}
          >
            <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-line-strong" />
            <div className="px-5 pt-3 pb-2">
              <Drawer.Title className="text-[17px] font-semibold tracking-tight text-fg">{title}</Drawer.Title>
              {description ? (
                <Drawer.Description className="mt-0.5 text-sm text-fg-muted">{description}</Drawer.Description>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
            {footer ? (
              <div className="pb-safe border-t border-line bg-surface px-5 pt-3">
                <div className="flex gap-2 pb-3 [&>*]:flex-1">{footer}</div>
              </div>
            ) : null}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <RadixDialog.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-line bg-surface shadow-soft outline-none",
            sizes[size],
          )}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
            <div>
              <RadixDialog.Title className="text-[17px] font-semibold tracking-tight text-fg">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-0.5 text-sm text-fg-muted">{description}</RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close
              className="-mr-2 flex size-8 items-center justify-center rounded-full text-fg-muted hover:bg-hover hover:text-fg"
              aria-label="Close"
            >
              <X className="size-4" />
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">{children}</div>
          {footer ? <div className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
