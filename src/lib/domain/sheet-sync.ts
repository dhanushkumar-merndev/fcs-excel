import { formatTime, timeAgo } from "./format";
import type { Tint } from "./stages";

/** The sheet_sync columns staff can read (the rest is configuration and stays server-side). */
export const SHEET_SYNC_COLUMNS =
  "enabled, running_since, last_synced_at, last_finished_at, last_status, last_error, last_created, last_skipped, last_invalid, last_batch_id, consecutive_failures";

export type SheetSyncStatus = {
  enabled: boolean;
  running_since: string | null;
  last_synced_at: string | null;
  last_finished_at: string | null;
  last_status: "never" | "ok" | "unchanged" | "error";
  last_error: string | null;
  last_created: number;
  last_skipped: number;
  last_invalid: number;
  last_batch_id: string | null;
  consecutive_failures: number;
};

export const SYNC_EVERY_MINUTES = 10;
/** Two missed runs and a bit: something is wrong with the schedule. */
const STALE_MS = 25 * 60_000;
const LOCK_MS = 5 * 60_000;

export function isSyncSetUp(s: SheetSyncStatus | null): s is SheetSyncStatus {
  return Boolean(s && (s.enabled || s.last_status !== "never"));
}

/**
 * Chip label and colour. `now` is null until the page is hydrated, so the server and the first
 * client render agree ("Synced 2:10 PM"); after that the label is relative ("Synced 3 min ago").
 */
export function syncHealth(s: SheetSyncStatus, now: number | null): { tint: Tint; label: string; running: boolean } {
  const running = Boolean(s.running_since && now !== null && now - Date.parse(s.running_since) < LOCK_MS);
  const when = s.last_synced_at ? (now === null ? formatTime(s.last_synced_at) : timeAgo(s.last_synced_at, new Date(now))) : null;
  if (running) return { tint: "blue", label: "Syncing…", running };
  if (!s.enabled) return { tint: "gray", label: "Sync paused", running };
  if (s.last_status === "error") return { tint: "red", label: "Sync failing", running };
  if (!when) return { tint: "gray", label: "Waiting for first sync", running };
  const stale = now !== null && now - Date.parse(s.last_synced_at!) > STALE_MS;
  return { tint: stale ? "amber" : "green", label: `Synced ${when}`, running };
}
