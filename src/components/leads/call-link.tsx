"use client";

import { Copy, Phone } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { buttonVariants, type ButtonProps } from "@/components/ui/button";
import { formatPhone } from "@/lib/domain/format";
import { cn } from "@/lib/utils";

function recordDial(leadId: string) {
  const url = `/api/leads/${leadId}/dial`;
  try {
    if (navigator.sendBeacon?.(url)) return;
  } catch {
    // fall through
  }
  void fetch(url, { method: "POST", keepalive: true }).catch(() => undefined);
}

/**
 * Opens the phone app via tel: and records only a "dial requested" event. When the user comes
 * back to the app it asks how the call went (onReturn) — nothing is logged automatically.
 */
export function CallLink({
  leadId,
  phone,
  onReturn,
  variant = "primary",
  size = "md",
  className,
  children,
  label = "Call",
}: {
  leadId: string;
  phone: string;
  onReturn?: () => void;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  children?: ReactNode;
  label?: string;
}) {
  const armed = useRef(false);
  const left = useRef(false);

  useEffect(() => {
    const onVisibility = () => {
      if (!armed.current) return;
      if (document.visibilityState === "hidden") left.current = true;
      else if (left.current) {
        armed.current = false;
        left.current = false;
        onReturn?.();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [onReturn]);

  return (
    <a
      href={`tel:${phone}`}
      aria-label={`${label} ${formatPhone(phone)}`}
      className={cn(buttonVariants({ variant, size }), className)}
      onClick={() => {
        recordDial(leadId);
        armed.current = true;
        left.current = false;
        // Desktop: the page usually stays visible, so offer logging via a toast instead.
        window.setTimeout(() => {
          if (armed.current && !left.current && onReturn) {
            armed.current = false;
            toast("Calling " + formatPhone(phone), {
              description: "Log the outcome when you're done.",
              action: { label: "Log call", onClick: onReturn },
              duration: 15_000,
            });
          }
        }, 2500);
      }}
    >
      {children ?? (
        <>
          <Phone /> {label}
        </>
      )}
    </a>
  );
}

export function CopyPhoneButton({ phone, className, compact }: { phone: string; className?: string; compact?: boolean }) {
  return (
    <button
      type="button"
      aria-label={compact ? "Copy number" : undefined}
      title={compact ? "Copy number" : undefined}
      className={cn(
        compact
          ? "inline-flex size-7 items-center justify-center rounded-full text-fg-subtle hover:bg-hover hover:text-fg [&_svg]:size-3.5"
          : buttonVariants({ variant: "secondary", size: "md" }),
        className,
      )}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(phone);
          toast.success("Number copied", { description: formatPhone(phone) });
        } catch {
          toast.error("Couldn't copy. Select the number manually.");
        }
      }}
    >
      <Copy />
      {compact ? null : " Copy number"}
    </button>
  );
}
