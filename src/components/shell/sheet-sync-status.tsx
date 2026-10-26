"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Popover } from "radix-ui";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/domain/format";
import { everyLabel, isSyncSetUp, SHEET_SYNC_COLUMNS, syncHealth, type SheetSyncStatus } from "@/lib/domain/sheet-sync";
import type { Tint } from "@/lib/domain/stages";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useSyncedState } from "@/lib/hooks";
import { cn } from "@/lib/utils";

// A clock shared by every subscriber, ticking every 30 s; null while server rendering and hydrating.
// Read lazily in the browser only: reading the time while prerendering is an error under Cache Components.
let clock = 0;
const subscribeClock = (onChange: () => void) => {
  const id = window.setInterval(() => {
    clock = Date.now();
    onChange();
  }, 30_000);
  return () => window.clearInterval(id);
};
const useNow = () => useSyncExternalStore(subscribeClock, () => (clock ||= Date.now()), () => null);

const dotTint: Partial<Record<Tint, string>> = {
  green: "bg-success",
  amber: "bg-tint-amber-fg",
  red: "bg-danger",
  blue: "bg-tint-blue-fg",
  gray: "bg-fg-muted",
};

/** Fetches the latest sync status; returns null if it couldn't be read. */
async function loadStatus() {
  const { data, error } = await getBrowserClient().from("sheet_sync").select(SHEET_SYNC_COLUMNS).eq("id", 1).maybeSingle();
  return error ? null : (data as SheetSyncStatus | null);
}

/** Starts a sync now (admins and managers). Shared by the top bar and the Imports page. */
export function useSyncNow(onDone?: () => void) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const run = useCallback(async () => {
    setRunning(true);
    try {
      const response = await fetch("/api/sync/sheet", { method: "POST" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) toast.error(json.message ?? "Sync failed. Try again.");
      else if (json.status === "unchanged") toast.success("Sheet checked", { description: "No new rows since the last sync." });
      else
        toast.success("Sheet synced", {
          description: `${json.created} new lead${json.created === 1 ? "" : "s"} · ${json.skipped} skipped · ${json.invalid} invalid${json.continuesNextRun ? " · more on the next run" : ""}`,
        });
      router.refresh();
    } catch {
      toast.error("Couldn't reach the server. Check your connection.");
    } finally {
      setRunning(false);
      onDone?.();
    }
  }, [router, onDone]);
  return { run, running };
}

export function SyncNowButton() {
  const { run, running } = useSyncNow();
  return (
    <Button variant="secondary" loading={running} onClick={() => void run()}>
      {running ? null : <RefreshCw />} Sync sheet now
    </Button>
  );
}

export function SheetSyncStatusChip({ initial, canRun }: { initial: SheetSyncStatus | null; canRun: boolean }) {
  const [status, setStatus] = useSyncedState(initial);
  const now = useNow();

  const refresh = useCallback(async () => {
    const next = await loadStatus();
    if (next) setStatus(next);
  }, [setStatus]);
  const { run, running } = useSyncNow(refresh);

  // A light poll (one primary-key read) while the tab is visible; every run updates the row.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(onVisible, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(id);
    };
  }, [refresh]);

  if (!isSyncSetUp(status)) return null;
  const health = syncHealth(status, now);
  const busy = running || health.running;

  return (
    <Popover.Root>
      <Popover.Trigger
        className="flex h-10 items-center gap-2 rounded-full px-3 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
        aria-label={`Google Sheet sync: ${health.label}`}
      >
        {busy ? (
          <RefreshCw className="size-4 animate-spin" />
        ) : (
          <span aria-hidden className={cn("size-2 rounded-full", dotTint[health.tint])} />
        )}
        <span className="tabular hidden whitespace-nowrap sm:inline">{busy ? "Syncing…" : health.label}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 w-[min(340px,calc(100vw-24px))] rounded-2xl border border-line bg-surface p-4 text-sm shadow-soft outline-none"
        >
          <p className="font-semibold">Google Sheet sync</p>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            {status.enabled
              ? `New rows from ${status.all_tabs ? "every tab" : "the chosen tabs"} are imported ${everyLabel(status.interval_minutes)}.`
              : "Paused — new rows aren't being imported."}
          </p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
            <dt className="text-fg-muted">Last synced</dt>
            <dd className="tabular">{status.last_synced_at ? formatDateTime(status.last_synced_at) : "Not yet"}</dd>
            {status.last_status === "ok" || status.last_created || status.last_skipped || status.last_invalid ? (
              <>
                <dt className="text-fg-muted">Last import</dt>
                <dd className="tabular">
                  {status.last_created} new · {status.last_skipped} skipped · {status.last_invalid} invalid
                  {canRun && status.last_batch_id ? (
                    <>
                      {" · "}
                      <Link href={`/imports/${status.last_batch_id}`} className="underline underline-offset-2 hover:text-fg">
                        rows
                      </Link>
                    </>
                  ) : null}
                </dd>
              </>
            ) : null}
          </dl>
          {status.last_status === "error" && status.last_error ? (
            <p className="mt-3 flex gap-2 rounded-xl bg-tint-red p-3 text-[13px] text-tint-red-fg">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                {status.last_error}
                {status.consecutive_failures > 1 ? ` (${status.consecutive_failures} runs in a row)` : ""}
              </span>
            </p>
          ) : null}
          {canRun && status.enabled ? (
            <Button size="sm" variant="secondary" className="mt-4 w-full" loading={busy} onClick={() => void run()}>
              {busy ? null : <RefreshCw />} Sync now
            </Button>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
