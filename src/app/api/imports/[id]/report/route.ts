import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireApiStaff } from "@/lib/api";
import { buildCsv, buildWorkbook, fileResponse, type SheetSpec } from "@/lib/export/sheet";
import type { DuplicateWarning } from "@/lib/import/duplicates";
import type { Issue } from "@/lib/import/normalize";
import { SKIP_REASON_LABELS } from "@/lib/import/prepare";
import { createClient } from "@/lib/supabase/server";

type Row = {
  row_number: number;
  status: string;
  skip_reason: string | null;
  error_message: string | null;
  issues: Issue[];
  warnings: DuplicateWarning[];
  lead_id: string | null;
  raw: Record<string, string>;
};

/**
 * Row-level results for an import: every row with its outcome, problems and duplicate warnings.
 * ?only=problems limits to invalid, failed, skipped and warned rows.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/imports/[id]/report">) {
  const staff = await requireApiStaff(request, ["admin", "manager"]);
  if (staff instanceof NextResponse) return staff;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError("Import not found.", 404);
  const format = request.nextUrl.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const onlyProblems = request.nextUrl.searchParams.get("only") === "problems";

  const supabase = await createClient();
  const { data: batch } = await supabase.from("import_batches").select("id, file_name, created_at").eq("id", id).maybeSingle();
  if (!batch) return jsonError("Import not found.", 404);

  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("import_rows")
      .select("row_number, status, skip_reason, error_message, issues, warnings, lead_id, raw")
      .eq("batch_id", id)
      .order("row_number")
      .range(from, from + 999);
    if (error) return jsonError("Couldn't load import rows.", 500);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }

  const filtered = onlyProblems
    ? rows.filter((r) => r.status !== "created" || r.warnings.length > 0 || r.issues.some((i) => i.severity !== "info"))
    : rows;
  const origin = request.nextUrl.origin;
  const sheet: SheetSpec = {
    name: "Rows",
    columns: [
      { header: "Spreadsheet row", type: "number" },
      { header: "Outcome", type: "text", width: 12 },
      { header: "Customer name", type: "text", width: 24 },
      { header: "Phone (original)", type: "text", width: 18 },
      { header: "Source lead ID (original)", type: "text", width: 24 },
      { header: "Errors", type: "text", width: 50 },
      { header: "Warnings & review flags", type: "text", width: 60 },
      { header: "Duplicate warnings", type: "text", width: 60 },
      { header: "Skip / failure reason", type: "text", width: 40 },
      { header: "Lead link", type: "text", width: 40 },
    ],
    rows: filtered.map((r) => [
      r.row_number,
      r.status,
      r.raw.full_name ?? Object.entries(r.raw).find(([k]) => k.trim().toLowerCase() === "full_name")?.[1] ?? "",
      r.raw.phone ?? Object.entries(r.raw).find(([k]) => k.trim().toLowerCase() === "phone")?.[1] ?? "",
      r.raw.id ?? Object.entries(r.raw).find(([k]) => k.trim().toLowerCase() === "id")?.[1] ?? "",
      r.issues.filter((i) => i.severity === "error").map((i) => i.message).join(" | "),
      r.issues.filter((i) => i.severity !== "error").map((i) => i.message).join(" | "),
      r.warnings.map((w) => `${w.reason}${w.lead ? ` (L-${w.lead.number} ${w.lead.name})` : w.row ? ` (row ${w.row.rowNumber})` : ""}`).join(" | "),
      r.status === "failed" ? r.error_message ?? "Unknown error" : r.skip_reason ? SKIP_REASON_LABELS[r.skip_reason] ?? r.skip_reason : "",
      r.lead_id ? `${origin}/leads/${r.lead_id}` : "",
    ]),
  };
  const base = `${batch.file_name.replace(/\.(xlsx|csv)$/i, "")} - ${onlyProblems ? "problems" : "results"}`;
  return format === "csv" ? fileResponse(buildCsv(sheet), `${base}.csv`, "csv") : fileResponse(buildWorkbook([sheet]), `${base}.xlsx`, "xlsx");
}
