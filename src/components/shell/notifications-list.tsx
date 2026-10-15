"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { markNotificationsRead } from "@/actions/notifications";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime, timeAgo } from "@/lib/domain/format";
import type { NotificationRow } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { notificationIcon } from "./notification-bell";

export function NotificationsList({ items }: { items: NotificationRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const unread = items.filter((n) => !n.read_at).length;

  if (!items.length) {
    return (
      <div className="rounded-2xl border border-line">
        <EmptyState icon={<Bell />} title="No notifications yet" description="You'll be notified about new assignments, due follow-ups and finished imports." />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-fg-muted">{unread ? `${unread} unread` : "All read"}</p>
        <Button
          size="sm"
          variant="secondary"
          disabled={!unread}
          loading={pending}
          onClick={() => startTransition(async () => void (await markNotificationsRead(null)))}
        >
          Mark all read
        </Button>
      </div>
      <ul className="overflow-hidden rounded-2xl border border-line">
        {items.map((n) => (
          <li key={n.id} className="border-b border-line last:border-0">
            <button
              type="button"
              className="flex w-full gap-3 px-4 py-3.5 text-left hover:bg-hover"
              onClick={() =>
                startTransition(async () => {
                  if (!n.read_at) await markNotificationsRead([n.id]);
                  if (n.link) router.push(n.link);
                })
              }
            >
              <span
                className={cn(
                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-subtle text-fg-muted [&_svg]:size-4",
                  n.type === "follow_up_overdue" && "bg-tint-red text-tint-red-fg",
                )}
              >
                {notificationIcon(n.type)}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm", n.read_at ? "text-fg-muted" : "font-medium")}>{n.title}</span>
                {n.body ? <span className="mt-0.5 block text-[13px] text-fg-subtle">{n.body}</span> : null}
                <span className="mt-1 block text-xs text-fg-subtle" title={formatDateTime(n.created_at)}>
                  {timeAgo(n.created_at)}
                </span>
              </span>
              {n.read_at ? null : <span aria-label="Unread" className="mt-2 size-2 shrink-0 rounded-full bg-fg" />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
