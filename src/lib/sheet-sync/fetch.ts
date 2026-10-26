import { SheetSyncError } from "./plan";

const MAX_BYTES = 10 * 1024 * 1024;
const NOT_SHARED =
  "Google wouldn't let the CRM read the sheet. Check it is shared as \"Anyone with the link → Viewer\" and that the link is right.";

export { parseSheetUrl } from "../domain/sheet-sync";

/** CSV export of one tab: the smallest download, and read-only — the CRM can never change the sheet. */
export function sheetCsvUrl(sheetId: string, gid: string | null) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export`);
  url.searchParams.set("format", "csv");
  if (gid) url.searchParams.set("gid", gid);
  return url.toString();
}

/** Downloads from Google Sheets; `expectHtml` is for the tab list page (everything else must not be HTML). */
async function download(url: string, timeoutMs: number, expectHtml = false) {
  let response: Response;
  try {
    response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new SheetSyncError(
      (error as Error).name === "TimeoutError" ? `Google Sheets didn't respond within ${timeoutMs / 1000} seconds.` : "Couldn't reach Google Sheets.",
    );
  }
  if ([401, 403, 404].includes(response.status)) throw new SheetSyncError(NOT_SHARED);
  if (!response.ok) throw new SheetSyncError(`Google Sheets returned an error (HTTP ${response.status}). Try again in a minute.`);
  // A private sheet answers with a sign-in page instead of the file.
  if (!expectHtml && (response.headers.get("content-type") ?? "").includes("text/html")) throw new SheetSyncError(NOT_SHARED);
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) throw new SheetSyncError("The sheet is larger than 10 MB.");
  const body = await response.arrayBuffer();
  if (body.byteLength > MAX_BYTES) throw new SheetSyncError("The sheet is larger than 10 MB.");
  return { response, body };
}

export async function fetchSheetCsv(sheetId: string, gid: string | null, timeoutMs = 20_000): Promise<string> {
  const { body } = await download(sheetCsvUrl(sheetId, gid), timeoutMs);
  return new TextDecoder("utf-8").decode(body);
}

export type SheetTab = { gid: string; name: string };

/** Reads a JavaScript string literal's escapes (\x3d, \u0027, \/, \"). */
function unescapeJs(text: string) {
  return text.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g, (_, e: string) =>
    e[0] === "x" || e[0] === "u" ? String.fromCharCode(parseInt(e.slice(1), 16)) : e === "n" ? "\n" : e === "t" ? "\t" : e,
  );
}

/** The tab list from the sheet's read-only HTML view, in sheet order. */
export function parseTabList(html: string): SheetTab[] {
  const tabs: SheetTab[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/\{name:\s*"((?:[^"\\]|\\.)*)",\s*pageUrl:\s*"(?:[^"\\]|\\.)*",\s*gid:\s*"(\d+)"/g)) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    tabs.push({ gid: m[2], name: unescapeJs(m[1]) });
  }
  return tabs;
}

/**
 * Every tab of a sheet shared as "Anyone with the link". Google has no keyless API for this, so it
 * is read from the sheet's HTML view (the same list as the tabs along the bottom).
 */
export async function listSheetTabs(sheetId: string, timeoutMs = 20_000): Promise<SheetTab[]> {
  const { body } = await download(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/htmlview`, timeoutMs, true);
  const html = new TextDecoder("utf-8").decode(body);
  const tabs = parseTabList(html);
  if (!tabs.length) {
    if (/accounts\.google\.com|ServiceLogin/.test(html)) throw new SheetSyncError(NOT_SHARED);
    throw new SheetSyncError("Couldn't read the sheet's tabs. Check the link and try again.");
  }
  return tabs;
}

/** The whole spreadsheet, every tab, as .xlsx (typed cells, so the import reads it like an uploaded file). */
export async function fetchSheetXlsx(sheetId: string, timeoutMs = 30_000): Promise<{ fileName: string; body: ArrayBuffer }> {
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=xlsx`;
  const { response, body } = await download(url, timeoutMs);
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  let fileName = disposition.match(/filename="([^"]+)"/i)?.[1] ?? "Google Sheet.xlsx";
  if (encoded) {
    try {
      fileName = decodeURIComponent(encoded);
    } catch {
      // Keep the plain filename.
    }
  }
  return { fileName: fileName.toLowerCase().endsWith(".xlsx") ? fileName : `${fileName}.xlsx`, body };
}
