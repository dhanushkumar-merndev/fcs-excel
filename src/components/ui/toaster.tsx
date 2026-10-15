"use client";

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="top-center"
      gap={8}
      visibleToasts={3}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-[calc(100vw-2rem)] max-w-sm items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-fg shadow-soft",
          title: "font-medium",
          description: "mt-0.5 text-fg-muted",
          icon: "mt-0.5 [&_svg]:size-4",
          success: "[&_[data-icon]]:text-success",
          error: "[&_[data-icon]]:text-danger",
          actionButton: "ml-auto rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-fg",
          cancelButton: "rounded-full px-3 py-1 text-xs text-fg-muted hover:bg-hover",
        },
      }}
    />
  );
}
