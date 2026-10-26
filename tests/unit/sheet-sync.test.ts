import { describe, expect, it } from "vitest";
import { syncHealth, type SheetSyncStatus } from "@/lib/domain/sheet-sync";
import { parseSheetUrl, parseTabList, sheetCsvUrl } from "@/lib/sheet-sync/fetch";
import { batchToken, planSheetSync, SheetSyncError, type SyncLookups, type SyncState } from "@/lib/sheet-sync/plan";

const HEADER = "id,created_time,full_name,phone";
const row = (n: number) => `l:${n},2026-10-01T10:00:00+05:30,Lead ${n},p:+9198450${String(n).padStart(5, "0")}`;
const sheet = (from: number, to: number) => [HEADER, ...Array.from({ length: to - from + 1 }, (_, i) => row(from + i))].join("\n");
const START: SyncState = { contentHash: null, processedThroughRow: 0, prefixHash: null, hasMore: false };

/** Nothing in the CRM yet; records which keys each lookup was asked about. */
function emptyCrm() {
  const asked: string[][] = [];
  const lookups: SyncLookups = {
    async missingKeys(ids, fps) {
      asked.push(ids);
      return new Set([...ids.map((k) => `id:${k}`), ...fps.map((k) => `fp:${k}`)]);
    },
    async findMatches() {
      return [];
    },
  };
  return { asked, lookups };
}

const stateAfter = (plan: Awaited<ReturnType<typeof planSheetSync>>): SyncState => {
  if (plan.kind !== "changed") throw new Error("expected a change");
  return { contentHash: plan.contentHash, processedThroughRow: plan.processedThroughRow, prefixHash: plan.prefixHash, hasMore: plan.hasMore };
};

describe("sheet sync planning", () => {
  it("does no work at all when the sheet is unchanged", async () => {
    const { asked, lookups } = emptyCrm();
    const first = await planSheetSync(sheet(1, 3), START, lookups);
    expect(first).toMatchObject({ kind: "changed", processedThroughRow: 4, hasMore: false, summary: { toCreate: 3 } });
    asked.length = 0;
    expect(await planSheetSync(sheet(1, 3), stateAfter(first), lookups)).toEqual({ kind: "unchanged" });
    expect(asked).toEqual([]);
  });

  it("only looks up rows added since the last run", async () => {
    const { asked, lookups } = emptyCrm();
    const first = await planSheetSync(sheet(1, 3), START, lookups);
    asked.length = 0;
    const next = await planSheetSync(sheet(1, 5), stateAfter(first), lookups);
    expect(asked).toEqual([["l:4", "l:5"]]);
    expect(next).toMatchObject({ kind: "changed", summary: { considered: 2, toCreate: 2, rescanned: false } });
    if (next.kind === "changed") expect(next.chunks.flat().map((r) => r.row_number)).toEqual([5, 6]);
  });

  it("works through a backlog a few rows per run, resuming where it stopped", async () => {
    const { lookups } = emptyCrm();
    const first = await planSheetSync(sheet(1, 5), START, lookups, 2);
    expect(first).toMatchObject({ processedThroughRow: 3, hasMore: true, summary: { toCreate: 2, remaining: 3 } });
    // Same content, but hasMore: the next run continues instead of reporting "unchanged".
    const second = await planSheetSync(sheet(1, 5), stateAfter(first), lookups, 2);
    expect(second).toMatchObject({ processedThroughRow: 5, hasMore: true });
    if (second.kind === "changed") expect(second.chunks.flat().map((r) => r.row_number)).toEqual([4, 5]);
    const third = await planSheetSync(sheet(1, 5), stateAfter(second), lookups, 2);
    expect(third).toMatchObject({ processedThroughRow: 6, hasMore: false });
    expect(await planSheetSync(sheet(1, 5), stateAfter(third), lookups, 2)).toEqual({ kind: "unchanged" });
  });

  it("splits large imports into batches of at most 1,000 rows", async () => {
    const { lookups } = emptyCrm();
    const plan = await planSheetSync(sheet(1, 1500), START, lookups);
    if (plan.kind !== "changed") throw new Error("expected a change");
    expect(plan.chunks.map((c) => c.length)).toEqual([1000, 500]);
  });

  it("stops on a sheet whose header row lost a required column", async () => {
    const { lookups } = emptyCrm();
    await expect(planSheetSync("id,full_name\nl:1,Asha", START, lookups)).rejects.toThrow(SheetSyncError);
  });

  it("treats an empty tab, or one with only a header row, as nothing to import", async () => {
    const { lookups } = emptyCrm();
    for (const csv of ["", "id,full_name,phone"]) {
      const plan = await planSheetSync(csv, START, lookups);
      expect(plan).toMatchObject({ kind: "changed", chunks: [], summary: { sheetRows: 0 } });
    }
  });

  it("derives a stable UUID per batch, so a retried run reuses its batch", () => {
    expect(batchToken("abc", 2)).toBe(batchToken("abc", 2));
    expect(batchToken("abc", 2)).not.toBe(batchToken("abc", 1002));
    expect(batchToken("abc", 2)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("sheet links", () => {
  it("reads the sheet ID and tab from an edit link", () => {
    expect(parseSheetUrl("https://docs.google.com/spreadsheets/d/1uE52SYaoXvhcoYIpg6kznf5WvoS9p5EVBr2WT9xTYkA/edit?gid=346543988#gid=346543988")).toEqual({
      sheetId: "1uE52SYaoXvhcoYIpg6kznf5WvoS9p5EVBr2WT9xTYkA",
      gid: "346543988",
    });
    expect(parseSheetUrl("https://example.com/")).toBeNull();
    expect(sheetCsvUrl("abc", "7")).toBe("https://docs.google.com/spreadsheets/d/abc/export?format=csv&gid=7");
  });
});

describe("sync status label", () => {
  const base: SheetSyncStatus = {
    enabled: true,
    interval_minutes: 10,
    all_tabs: true,
    running_since: null,
    last_synced_at: "2026-10-19T08:40:00Z",
    last_finished_at: null,
    last_status: "ok",
    last_error: null,
    last_created: 0,
    last_skipped: 0,
    last_invalid: 0,
    last_batch_id: null,
    consecutive_failures: 0,
  };
  const at = (iso: string) => Date.parse(iso);

  it("shows a clock time before hydration and a relative time after", () => {
    expect(syncHealth(base, null)).toMatchObject({ tint: "green", label: "Synced 2:10 PM" });
    expect(syncHealth(base, at("2026-10-19T08:43:00Z"))).toMatchObject({ tint: "green", label: "Synced 3 min ago" });
  });

  it("warns when runs stop arriving, and on failures, pauses and running syncs", () => {
    expect(syncHealth(base, at("2026-10-19T09:20:00Z")).tint).toBe("amber");
    expect(syncHealth({ ...base, last_status: "error" }, null)).toMatchObject({ tint: "red", label: "Sync failing" });
    expect(syncHealth({ ...base, enabled: false }, null)).toMatchObject({ tint: "gray", label: "Sync paused" });
    expect(syncHealth({ ...base, running_since: "2026-10-19T08:50:00Z" }, at("2026-10-19T08:50:30Z"))).toMatchObject({ running: true, label: "Syncing…" });
    expect(syncHealth({ ...base, last_synced_at: null }, null)).toMatchObject({ label: "Waiting for first sync" });
  });
});

describe("sheet tab list", () => {
  it("reads every tab's name and gid from the sheet's HTML view, in order", () => {
    const html = String.raw`items.push({name: "FRANCHISE PARTNER ", pageUrl: "https:\/\/docs.google.com\/x?headers\x3dtrue&gid=0", gid: "0",initialSheet: false});
      items.push({name: "Priya\x27s \u0022AI\u0022 tab", pageUrl: "https:\/\/docs.google.com\/x?gid=702333688", gid: "702333688"});
      items.push({name: "FRANCHISE PARTNER ", pageUrl: "u", gid: "0"});`;
    expect(parseTabList(html)).toEqual([
      { gid: "0", name: "FRANCHISE PARTNER " },
      { gid: "702333688", name: `Priya's "AI" tab` },
    ]);
    expect(parseTabList("<html>sign in</html>")).toEqual([]);
  });
});
