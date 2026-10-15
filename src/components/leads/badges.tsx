import { CalendarClock, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDue } from "@/lib/domain/format";
import { reviewFlagLabel } from "@/lib/domain/labels";
import { stageLabel, stageTint } from "@/lib/domain/stages";
import { cn } from "@/lib/utils";

export function StageBadge({ stage, className }: { stage: string; className?: string }) {
  return (
    <Badge tint={stageTint(stage)} dot className={className}>
      {stageLabel(stage)}
    </Badge>
  );
}

export function followUpState(nextAt: string | null, now: Date = new Date()) {
  if (!nextAt) return "none" as const;
  const due = new Date(nextAt);
  if (due < now) return "overdue" as const;
  const endOfToday = new Date(now.getTime() + 330 * 60_000);
  endOfToday.setUTCHours(24, 0, 0, 0);
  return due.getTime() < endOfToday.getTime() - 330 * 60_000 ? ("today" as const) : ("upcoming" as const);
}

export function FollowUpBadge({ nextAt, className, compact }: { nextAt: string | null; className?: string; compact?: boolean }) {
  const state = followUpState(nextAt);
  if (state === "none" || !nextAt) {
    return <span className={cn("text-[13px] text-fg-subtle", className)}>No follow-up</span>;
  }
  const label = formatDue(nextAt);
  if (state === "overdue") {
    return (
      <Badge tint="red" className={className}>
        <TriangleAlert className="size-3" aria-hidden />
        {compact ? "Overdue" : `Overdue · ${label}`}
      </Badge>
    );
  }
  if (state === "today") {
    return (
      <Badge tint="amber" className={className}>
        <CalendarClock className="size-3" aria-hidden />
        {label}
      </Badge>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] text-fg-muted", className)}>
      <CalendarClock className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

export function ReviewBadges({ flags }: { flags: string[] }) {
  if (!flags?.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f} tint="amber" className="h-5 px-2 text-[11px]">
          {reviewFlagLabel(f)}
        </Badge>
      ))}
    </span>
  );
}

export function PriorityMark({ priority }: { priority: string }) {
  if (priority !== "high") return null;
  return (
    <Badge tint="orange" className="h-5 px-2 text-[11px]">
      High priority
    </Badge>
  );
}
