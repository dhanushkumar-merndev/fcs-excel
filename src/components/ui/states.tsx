import { CircleAlert, Inbox, ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-subtle text-fg-muted [&_svg]:size-5">
        {icon ?? <Inbox />}
      </div>
      <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this. Check your connection and try again.",
  action,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <EmptyState
      icon={<CircleAlert className="text-danger" />}
      title={title}
      description={description}
      action={action}
    />
  );
}

export function PermissionDenied({
  title = "You don't have access to this",
  description = "Ask an admin if you think you should be able to see this page.",
}: {
  title?: string;
  description?: ReactNode;
}) {
  return (
    <EmptyState
      icon={<ShieldAlert />}
      title={title}
      description={description}
      action={
        <Link href="/" className={buttonVariants({ variant: "secondary" })}>
          Go to dashboard
        </Link>
      }
    />
  );
}

export function InlineAlert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: "bg-subtle text-fg border-line",
    warning: "bg-tint-amber text-tint-amber-fg border-transparent",
    danger: "bg-tint-red text-tint-red-fg border-transparent",
    success: "bg-tint-green text-tint-green-fg border-transparent",
  } as const;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-xl border px-3.5 py-3 text-sm", tones[tone], className)}>
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className={cn(title && "mt-0.5", "opacity-90")}>{children}</div> : null}
    </div>
  );
}
