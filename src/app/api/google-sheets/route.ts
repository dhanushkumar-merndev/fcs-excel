import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, requireApiStaff } from "@/lib/api";
import { fetchSheetXlsx, listSheetTabs, parseSheetUrl } from "@/lib/sheet-sync/fetch";
import { SheetSyncError } from "@/lib/sheet-sync/plan";

export const maxDuration = 60;

const schema = z.object({ url: z.string().trim().min(1).max(2000), part: z.enum(["tabs", "file"]) });

/**
 * Reads a Google Sheet shared as "Anyone with the link" for an admin or manager. Browsers can't
 * download from Google directly (CORS), so the server fetches it, read-only.
 *  - part "tabs": the sheet's tabs ({ sheetId, tabs: [{ gid, name }] }), for the sync settings.
 *  - part "file": the whole spreadsheet as .xlsx, every tab, for the import wizard; the wizard
 *    then handles it exactly like an uploaded file.
 */
export async function POST(request: NextRequest) {
  const staff = await requireApiStaff(request, ["admin", "manager"]);
  if (staff instanceof NextResponse) return staff;

  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError("Paste a Google Sheets link.", 400);
  const sheet = parseSheetUrl(body.data.url);
  if (!sheet) return jsonError("That isn't a Google Sheets link. Copy it from the browser's address bar while the sheet is open.", 422);

  try {
    if (body.data.part === "tabs") {
      return NextResponse.json({ ok: true, sheetId: sheet.sheetId, tabs: await listSheetTabs(sheet.sheetId) });
    }
    const { fileName, body: file } = await fetchSheetXlsx(sheet.sheetId);
    return new NextResponse(file, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "X-File-Name": encodeURIComponent(fileName),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof SheetSyncError) return jsonError(error.message, 422);
    console.error("Google Sheet fetch failed", error);
    return jsonError("Couldn't read the sheet. Try again in a minute.", 502);
  }
}
