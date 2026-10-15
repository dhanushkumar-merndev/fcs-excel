"use client";

import { Bell, CalendarClock, CircleCheck, FileSpreadsheet, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Popover } from "radix-ui";
import { useCallback, useEffect, useState, useTransition } from "react";
import { markNotificationsRead } from "@/actions/notifications";
import { Spinner } from "@/components/ui/spinner";
import { timeAgo } from "@/lib/domain/format";
import type { NotificationRow } from "@/lib/domain/types";
import { getBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

export function notificationIcon(type: string) {
  switch (type) {
    case "lead_assigned":
    case "lead_reassigned_away":
      return <UserPlus />;
    case "follow_up_due":
    case "follow_up_overdue":
      return <CalendarClock />;
    case "import_completed":
      return <FileSpreadsheet />;
    default:
      return <CircleCheck />;
  }
}

export function NotificationBell({ userId, initialUnread }: { userId: string; initialUnread: number }) {
  const router = useRouter();
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pending, startTransition] = useTransition();

  const refreshCount = useCallback(async () => {
    const supabase = getBrowserClient();
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    if (!error && typeof count === "number") setUnread(count);
  }, []);

  const loadList = useCallback(async () => {
    setLoadError(false);
    const supabase = getBrowserClient();
    const { data, error } = await supabase
      .from("notifications")
      .select("id, type, title, body, link, lead_id, created_at, read_at")
      .order("created_at", { ascending: false })
      .limit(15);
    if (error) setLoadError(true);
    else setItems(data as NotificationRow[]);
  }, []);

  useEffect(() => setUnread(initialUnread), [initialUnread]);

  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
        () => {
          void refreshCount();
          if (open) void loadList();
        },
      )
      .subscribe();
    const onFocus = () => {
      if (document.visibilityState === "visible") void refreshCount();
    };
    document.addEventListener("visibilitychange", onFocus);
    const interval = window.setInterval(onFocus, 60_000);
    return () => {
      void supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(interval);
    };
  }, [userId, open, refreshCount, loadList]);

  function openItem(item: NotificationRow) {
    setOpen(false);
    if (!item.read_at) {
      setUnread((n) => Math.max(0, n - 1));
      startTransition(async () => {
        await markNotificationsRead([item.id]);
      });
    }
    if (item.link) router.push(item.link);
  }

  function markAll() {
    startTransition(async () => {
      const result = await markNotificationsRead(null);
      if (result.ok) {
        setUnread(0);
        setItems((list) => list?.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })) ?? null);
      }
    });
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void loadList();
      }}
    >
      <Popover.Trigger
        className="relative flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-hover hover:text-fg"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <Bell className="size-[19px]" />
        {unread > 0 ? (
          <span className="tabular absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white dark:text-[#1a0d0b]">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-line bg-surface shadow-soft outline-none"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            <button
              type="button"
              onClick={markAll}
              disabled={pending || unread === 0}
              className="text-[13px] text-fg-muted hover:text-fg disabled:opacity-40"
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items === null && !loadError ? (
              <div className="flex justify-center py-10">
                <Spinner label="Loading notifications" />
              </div>
            ) : loadError ? (
              <p className="px-4 py-8 text-center text-sm text-fg-muted">
                Couldn&apos;t load notifications.{" "}
                <button type="button" className="underline" onClick={() => void loadList()}>
                  Retry
                </button>
              </p>
            ) : items && items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-fg-muted">You&apos;re all caught up.</p>
            ) : (
              <ul>
                {items?.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className="flex w-full gap-3 px-4 py-3 text-left hover:bg-hover"
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-subtle text-fg-muted [&_svg]:size-4",
                          item.type === "follow_up_overdue" && "bg-tint-red text-tint-red-fg",
                        )}
                      >
                        {notificationIcon(item.type)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-sm", item.read_at ? "text-fg-muted" : "font-medium text-fg")}>
                          {item.title}
                        </span>
                        {item.body ? <span className="mt-0.5 line-clamp-2 block text-[13px] text-fg-subtle">{item.body}</span> : null}
                        <span className="mt-1 block text-xs text-fg-subtle">{timeAgo(item.created_at)}</span>
                      </span>
                      {item.read_at ? null : <span aria-label="Unread" className="mt-2 size-2 shrink-0 rounded-full bg-fg" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-line px-4 py-3 text-center text-[13px] font-medium text-fg-muted hover:bg-hover hover:text-fg"
          >
            View all notifications
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
