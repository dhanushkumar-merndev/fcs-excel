import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** KPI tile that opens the corresponding filtered records. */
export function StatCard({
  label,
  value,
  href,
  hint,
  tone,
}: {
  label: string;
  value: number;
  href: string;
  hint?: string;
  tone?: "red" | "amber" | "green";
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col justify-between rounded-2xl border border-line bg-surface p-4 transition-colors hover:bg-hover/60"
    >
      <span className="flex items-start justify-between gap-2 text-[13px] text-fg-muted">
        {label}
        <ChevronRight className="size-4 shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
      <span
        className={cn(
          "mt-2 text-[28px] leading-none font-semibold tracking-tight",
          tone === "red" && value > 0 && "text-danger",
          tone === "amber" && value > 0 && "text-tint-amber-fg",
          tone === "green" && value > 0 && "text-success",
        )}
      >
        {value.toLocaleString("en-IN")}
      </span>
      {hint ? <span className="mt-1.5 text-xs text-fg-subtle">{hint}</span> : null}
    </Link>
  );
}
