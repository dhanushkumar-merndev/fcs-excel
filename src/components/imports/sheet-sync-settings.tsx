"use client";

import { ExternalLink, FileSpreadsheet, RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { saveSheetSync } from "@/actions/sheet-sync";
import { reportSessionExpired } from "@/components/shell/connection-watch";
import { useSyncNow } from "@/components/shell/sheet-sync-status";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/states";
import { formatDateTime } from "@/lib/domain/format";
import {
  everyLabel,
  parseSheetUrl,
  sheetLink,
  SYNC_INTERVALS,
  type SheetSyncSettings,
  type SheetSyncStatus,
  type SheetSyncTab,
} from "@/lib/domain/sheet-sync";
import { cn } from "@/lib/utils";

type TabChoice = { gid: string; name: string; enabled: boolean };

export function SheetSyncSettingsForm({
  settings,
  status,
  tabStatus,
}: {
  settings: SheetSyncSettings;
  status: SheetSyncStatus | null;
  tabStatus: SheetSyncTab[];
}) {
  const configured = Boolean(settings.sheet_id);
  const [link, setLink] = useState(settings.sheet_id ? sheetLink(settings.sheet_id) : "");
  const [tabs, setTabs] = useState<TabChoice[]>(settings.tabs.filter((t) => !t.removed).map(({ gid, name, enabled }) => ({ gid, name, enabled })));
  // The sheet the tab list belongs to: saving needs the tabs of the sheet in the link box.
  const [tabsFor, setTabsFor] = useState<string | null>(settings.tabs.length ? settings.sheet_id : null);
  const [allTabs, setAllTabs] = useState(configured ? settings.all_tabs : true);
  const [interval, setIntervalMinutes] = useState(settings.interval_minutes);
  const [enabled, setEnabled] = useState(configured ? settings.enabled : true);
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, running } = useSyncNow();

  const sheetId = parseSheetUrl(link)?.sheetId ?? null;
  const tabsReady = Boolean(sheetId && tabsFor === sheetId && tabs.length);
  const ticked = allTabs ? tabs.length : tabs.filter((t) => t.enabled).length;
  const statusByGid = new Map(tabStatus.map((t) => [t.gid, t]));
  const dirty =
    !configured ||
    sheetId !== settings.sheet_id ||
    allTabs !== settings.all_tabs ||
    interval !== settings.interval_minutes ||
    enabled !== settings.enabled ||
    tabs.some((t) => settings.tabs.find((s) => s.gid === t.gid)?.enabled !== t.enabled);

  async function loadTabs() {
    setError(null);
    if (!sheetId) {
      setError("That isn't a Google Sheets link. Copy it from the browser's address bar while the sheet is open.");
      return;
    }
    setLoadingTabs(true);
    try {
      const res = await fetch("/api/google-sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link, part: "tabs" }),
      });
      if (res.status === 401) reportSessionExpired();
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? "Couldn't read the sheet's tabs.");
      const known = new Map((tabsFor === sheetId ? tabs : []).map((t) => [t.gid, t.enabled]));
      setTabs((json.tabs as { gid: string; name: string }[]).map((t) => ({ ...t, enabled: known.get(t.gid) ?? true })));
      setTabsFor(sheetId);
    } catch (e) {
      setError(e instanceof TypeError ? "Couldn't reach the server. Check your connection." : (e as Error).message);
    } finally {
      setLoadingTabs(false);
    }
  }

  async function save() {
    setError(null);
    setSaving(true);
    const result = await saveSheetSync({ link, allTabs, tabs, intervalMinutes: interval, enabled });
    setSaving(false);
    if (!result.ok) {
      if (result.code === "unauthenticated") reportSessionExpired();
      setError(result.message);
      return;
    }
    toast.success(enabled ? "Sync saved" : "Sync saved and paused", {
      description: enabled ? `${allTabs ? "Every tab" : `${ticked} ${ticked === 1 ? "tab" : "tabs"}`}, ${everyLabel(interval)}.` : "Nothing is imported until you turn it back on.",
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <InlineAlert tone="danger" title="Google Sheet sync">
          {error}
        </InlineAlert>
      ) : null}
      {configured && !settings.scheduled ? (
        <InlineAlert tone="warning" title="Automatic runs aren't installed yet">
          Sync now works, but nothing runs on its own until the schedule is installed on the database (<code className="font-mono text-[13px]">pnpm sync:setup</code>).
        </InlineAlert>
      ) : null}
      {status?.last_status === "error" && status.last_error ? (
        <InlineAlert tone="danger" title="The last sync failed">
          {status.last_error}
        </InlineAlert>
      ) : null}

      <Card className="p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold">Sheet</h2>
        <p className="mt-0.5 mb-4 text-sm text-fg-muted">
          Share it as <span className="font-medium text-fg">Anyone with the link → Viewer</span>. The CRM only reads it and can never change it.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Google Sheets link" htmlFor="sheet-link" className="min-w-0 flex-1">
            <Input
              id="sheet-link"
              inputMode="url"
              placeholder="https://docs.google.com/spreadsheets/d/…"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void loadTabs();
              }}
            />
          </Field>
          <Button variant="secondary" loading={loadingTabs} onClick={() => void loadTabs()} disabled={!link.trim()}>
            {loadingTabs ? null : <RefreshCw />} {tabsReady ? "Refresh tabs" : "Load tabs"}
          </Button>
          {sheetId ? (
            <a
              href={sheetLink(sheetId)}
              target="_blank"
              rel="noreferrer"
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-sm text-fg-muted hover:bg-hover hover:text-fg"
            >
              <ExternalLink className="size-4" /> Open
            </a>
          ) : null}
        </div>
      </Card>

      {tabsReady ? (
        <Card className="p-4 sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold">Tabs</h2>
              <p className="mt-0.5 text-sm text-fg-muted">Each tab is read on its own. A lead that is already in the CRM — from any tab or an upload — is skipped.</p>
            </div>
            {!allTabs ? (
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={() => setTabs((list) => list.map((t) => ({ ...t, enabled: ticked !== list.length })))}
              >
                {ticked === tabs.length ? "Clear all" : "Select all"}
              </Button>
            ) : null}
          </div>
          <label className="mb-3 flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-subtle px-4 py-3">
            <Checkbox className="mt-0.5" checked={allTabs} onChange={(e) => setAllTabs(e.target.checked)} />
            <span>
              <span className="font-medium">Sync every tab, including tabs added later</span>
              <span className="block text-[13px] text-fg-muted">A new tab in the sheet is picked up on the next run, without coming back here.</span>
            </span>
          </label>
          <ul className="flex flex-col gap-2">
            {tabs.map((t) => {
              const s = statusByGid.get(t.gid);
              const checked = allTabs || t.enabled;
              return (
                <li key={t.gid}>
                  <label
                    className={cn(
                      "flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3 transition-colors",
                      allTabs ? "cursor-default" : "cursor-pointer hover:bg-hover",
                      checked ? "border-line" : "border-line opacity-60",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={allTabs}
                      onChange={() => setTabs((list) => list.map((x) => (x.gid === t.gid ? { ...x, enabled: !x.enabled } : x)))}
                    />
                    <FileSpreadsheet className="size-4 shrink-0 text-fg-muted" />
                    <span className="min-w-0 flex-1 truncate font-medium">{t.name.trim()}</span>
                    <TabStatusText status={s} />
                  </label>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {tabsReady ? (
        <Card className="p-4 sm:p-5">
          <h2 className="mb-4 text-[15px] font-semibold">Schedule</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Check the sheet" htmlFor="sync-interval" hint="Unchanged tabs cost almost nothing to check.">
              <Select id="sync-interval" value={interval} onChange={(e) => setIntervalMinutes(Number(e.target.value))}>
                {SYNC_INTERVALS.map((m) => (
                  <option key={m} value={m}>
                    {everyLabel(m)[0].toUpperCase() + everyLabel(m).slice(1)}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex cursor-pointer items-start gap-3 self-start rounded-xl border border-line px-4 py-3 sm:mt-6">
              <Checkbox className="mt-0.5" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span>
                <span className="font-medium">Sync is on</span>
                <span className="block text-[13px] text-fg-muted">Untick to pause. Nothing is imported while paused.</span>
              </span>
            </label>
          </div>
          {configured && settings.actor_name ? (
            <p className="mt-4 text-[13px] text-fg-muted">Synced leads are recorded as imported by {settings.actor_name}. Whoever saves becomes that person.</p>
          ) : null}
        </Card>
      ) : null}

      <div className="pb-safe sticky bottom-16 z-20 flex flex-col gap-2 border-t border-line bg-canvas/95 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between md:bottom-0">
        <p className="text-[13px] text-fg-muted">
          {!tabsReady
            ? "Paste the link and load the tabs."
            : !allTabs && ticked === 0 && enabled
              ? "Tick at least one tab."
              : status?.last_synced_at
                ? `Last synced ${formatDateTime(status.last_synced_at)}.`
                : `${allTabs ? "Every tab" : `${ticked} ${ticked === 1 ? "tab" : "tabs"}`}, ${everyLabel(interval)}.`}
        </p>
        <div className="flex gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
          {configured && settings.enabled ? (
            <Button variant="secondary" loading={running} onClick={() => void run()} disabled={dirty}>
              {running ? null : <RefreshCw />} Sync now
            </Button>
          ) : null}
          <Button onClick={() => void save()} loading={saving} disabled={!tabsReady || !dirty || (enabled && !allTabs && ticked === 0)}>
            {configured ? "Save changes" : "Start syncing"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TabStatusText({ status }: { status: SheetSyncTab | undefined }) {
  if (!status || status.last_status === "never") return <span className="text-[13px] text-fg-subtle">Not synced yet</span>;
  if (status.last_status === "error") {
    return (
      <span className="flex w-full items-start gap-1.5 text-[13px] text-danger sm:w-auto sm:max-w-[60%]">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        {status.last_error}
      </span>
    );
  }
  return (
    <span className="tabular text-[13px] text-fg-muted">
      Checked {formatDateTime(status.last_checked_at)}
      {status.last_batch_id ? (
        <>
          {" · "}
          <Link href={`/imports/${status.last_batch_id}`} className="underline underline-offset-2 hover:text-fg" onClick={(e) => e.stopPropagation()}>
            {status.last_created} new last time
          </Link>
        </>
      ) : null}
    </span>
  );
}
