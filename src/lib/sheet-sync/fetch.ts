import { SheetSyncError } from "./plan";

const MAX_BYTES = 10 * 1024 * 1024;
const NOT_SHARED =
  "Google wouldn't let the CRM read the sheet. Check it is shared as \"Anyone with the link → Viewer\" and that the link is right.";

/** Sheet ID and tab (gid) from a docs.google.com/spreadsheets/d/<id>/edit#gid=<gid> link. */
export function parseSheetUrl(input: string): { sheetId: string; gid: string | null } | null {
  const id = input.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/)?.[1];
  if (!id) return null;
  return { sheetId: id, gid: input.match(/[#?&]gid=(\d+)/)?.[1] ?? null };
}

/** CSV export of one tab: the smallest download, and read-only — the CRM can never change the sheet. */
export function sheetCsvUrl(sheetId: string, gid: string | null) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export`);
  url.searchParams.set("format", "csv");
  if (gid) url.searchParams.set("gid", gid);
  return url.toString();
}

export async function fetchSheetCsv(sheetId: string, gid: string | null, timeoutMs = 20_000): Promise<string> {
  let response: Response;
  try {
    response = await fetch(sheetCsvUrl(sheetId, gid), { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new SheetSyncError(
      (error as Error).name === "TimeoutError" ? `Google Sheets didn't respond within ${timeoutMs / 1000} seconds.` : "Couldn't reach Google Sheets.",
    );
  }
  if ([401, 403, 404].includes(response.status)) throw new SheetSyncError(NOT_SHARED);
  if (!response.ok) throw new SheetSyncError(`Google Sheets returned an error (HTTP ${response.status}). The next run will try again.`);
  // A private sheet answers with a sign-in page instead of CSV.
  if ((response.headers.get("content-type") ?? "").includes("text/html")) throw new SheetSyncError(NOT_SHARED);
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) throw new SheetSyncError("The sheet is larger than 10 MB.");
  const body = await response.arrayBuffer();
  if (body.byteLength > MAX_BYTES) throw new SheetSyncError("The sheet is larger than 10 MB.");
  return new TextDecoder("utf-8").decode(body);
}
