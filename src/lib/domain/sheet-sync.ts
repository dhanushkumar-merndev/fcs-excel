import { formatTime, timeAgo } from "./format";
import type { Tint } from "./stages";

/** The sheet_sync columns staff can read (the rest is configuration and stays server-side). */
export const SHEET_SYNC_COLUMNS =
  "enabled, interval_minutes, all_tabs, running_since, last_synced_at, last_finished_at, last_status, last_error, last_created, last_skipped, last_invalid, last_batch_id, consecutive_failures";

/** Each tab's status (sheet_sync_tabs), readable by all staff. */
export const SHEET_SYNC_TAB_COLUMNS =
  "gid, name, position, enabled, removed, last_checked_at, last_synced_at, last_status, last_error, last_created, last_skipped, last_invalid, last_batch_id";

export type SheetSyncTab = {
  gid: string;
  name: string;
  position: number;
  enabled: boolean;
  removed: boolean;
  last_checked_at: string | null;
  last_synced_at: string | null;
  last_status: "never" | "ok" | "unchanged" | "error";
  last_error: string | null;
  last_created: number;
  last_skipped: number;
  last_invalid: number;
  last_batch_id: string | null;
};

/** What admins and managers edit (sheet_sync_settings / sheet_sync_configure). */
export type SheetSyncSettings = {
  sheet_id: string | null;
  all_tabs: boolean;
  interval_minutes: number;
  enabled: boolean;
  scheduled: boolean;
  actor_name: string | null;
  tabs: { gid: string; name: string; position: number; enabled: boolean; removed: boolean }[];
};

export const SYNC_INTERVALS = [5, 10, 15, 30, 60] as const;

/** Sheet ID and tab (gid) from a docs.google.com/spreadsheets/d/<id>/edit#gid=<gid> link. */
export function parseSheetUrl(input: string): { sheetId: string; gid: string | null } | null {
  const id = input.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/)?.[1];
  if (!id) return null;
  return { sheetId: id, gid: input.match(/[#?&]gid=(\d+)/)?.[1] ?? null };
}

export const sheetLink = (sheetId: string) => `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;

export type SheetSyncStatus = {
  enabled: boolean;
  interval_minutes: number;
  all_tabs: boolean;
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

/** Two missed runs and a bit: something is wrong with the schedule. */
const staleMs = (s: SheetSyncStatus) => (2 * (s.interval_minutes || 10) + 5) * 60_000;

export const everyLabel = (minutes: number) => (minutes === 60 ? "every hour" : `every ${minutes} minutes`);
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
  const stale = now !== null && now - Date.parse(s.last_synced_at!) > staleMs(s);
  return { tint: stale ? "amber" : "green", label: `Synced ${when}`, running };
}
