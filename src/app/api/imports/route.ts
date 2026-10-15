import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { z } from "zod";
import { dbErrorResponse, jsonError, requireApiStaff } from "@/lib/api";
import type { ExistingLead } from "@/lib/import/duplicates";
import { ImportFileError, parseImportFile, rowLimitError } from "@/lib/import/parse";
import { buildStagedRows, matchKeys, normalizeAll, prepareImport } from "@/lib/import/prepare";
import { missingRequired, TEMPLATE_COLUMNS, type ColumnMapping } from "@/lib/import/template";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const templateKeys = TEMPLATE_COLUMNS.map((c) => c.key) as [string, ...string[]];

const metaSchema = z.object({
  clientToken: z.string().uuid(),
  sheetName: z.string().max(200).nullable(),
  mapping: z.record(z.enum(templateKeys), z.string().max(300).nullable()),
  yearChoice: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("unresolved") }),
    z.object({ mode: z.literal("fixed"), year: z.number().int().min(2000).max(2100) }),
    z.object({ mode: z.literal("after_created") }),
  ]),
  decisions: z.record(z.string().regex(/^\d+$/), z.enum(["import", "skip"])).default({}),
  defaultOwnerId: z.string().uuid().nullable(),
});

/**
 * Creates an import from the original file. Everything the browser previewed is recomputed here
 * from the file itself — parsing, cleaning, row limit and duplicate checks — before anything is saved.
 * Idempotent on clientToken: retries and double submissions return the same batch.
 */
export async function POST(request: NextRequest) {
  const staff = await requireApiStaff(request, ["admin", "manager"]);
  if (staff instanceof NextResponse) return staff;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("The upload didn't arrive completely. Check your connection and try again.", 400);
  }
  const file = form.get("file");
  const meta = metaSchema.safeParse(JSON.parse(String(form.get("meta") ?? "null")));
  if (!(file instanceof File) || !meta.success) return jsonError("Invalid import request.", 400);
  if (file.size > MAX_FILE_BYTES) return jsonError("The file is larger than 10 MB. Remove extra sheets or columns and try again.", 413);

  const supabase = await createClient();
  const { clientToken, sheetName, yearChoice, decisions, defaultOwnerId } = meta.data;
  const mapping = meta.data.mapping as ColumnMapping;

  // Retried request for a batch that is already staged: return it unchanged.
  const { data: existingBatch } = await supabase
    .from("import_batches")
    .select("id, status, total_rows, created_count, skipped_count, invalid_count, failed_count, pending_count")
    .eq("client_token", clientToken)
    .maybeSingle();
  if (existingBatch && existingBatch.status !== "staging") {
    return NextResponse.json({ ok: true, batchId: existingBatch.id, existing: true });
  }

  const buffer = await file.arrayBuffer();
  let parsed;
  try {
    parsed = parseImportFile(XLSX, file.name, buffer);
  } catch (error) {
    return jsonError(error instanceof ImportFileError ? error.message : "This file couldn't be read.", 422);
  }
  const sheet = parsed.sheets.find((s) => s.name === sheetName) ?? (parsed.sheets.length === 1 ? parsed.sheets[0] : null);
  if (!sheet) return jsonError("The selected worksheet wasn't found in the file.", 422);
  if (sheet.rows.length === 0) return jsonError("The selected sheet has no data rows.", 422);
  const limit = rowLimitError(sheet.rows.length);
  if (limit) return jsonError(limit, 422, { code: "row_limit" });
  for (const [key, header] of Object.entries(mapping)) {
    if (header && !sheet.headers.includes(header)) return jsonError(`Column "${header}" (mapped to ${key}) isn't in the sheet.`, 422);
  }
  const missing = missingRequired(mapping);
  if (missing.length) return jsonError(`Map the required columns: ${missing.join(", ")}.`, 422);

  const normalized = normalizeAll(sheet.rows, mapping, yearChoice);
  const keys = matchKeys(normalized);
  const { data: matches, error: matchError } = await supabase.rpc("import_find_matches", {
    p_phones: keys.phones,
    p_external_ids: keys.externalIds,
    p_raw_ids: keys.rawIds,
  });
  if (matchError) return dbErrorResponse(matchError);

  const numericDecisions = Object.fromEntries(Object.entries(decisions).map(([k, v]) => [Number(k), v]));
  const plan = prepareImport(normalized, (matches ?? []) as ExistingLead[], numericDecisions);
  if (plan.summary.undecided > 0) {
    const rows = plan.rows.filter((r) => r.status === "pending" && r.review.needsDecision && numericDecisions[r.row.rowNumber] === undefined);
    return jsonError(
      `${plan.summary.undecided} possible duplicate event(s) need a Keep or Skip decision. The data changed since your review — review duplicates again.`,
      409,
      { code: "decisions_required", rows: rows.map((r) => r.row.rowNumber) },
    );
  }

  const sha256 = createHash("sha256").update(Buffer.from(buffer)).digest("hex");
  const { data: batch, error: batchError } = await supabase.rpc("import_create_batch", {
    p_client_token: clientToken,
    p_meta: {
      file_name: file.name,
      file_size: file.size,
      file_sha256: sha256,
      sheet_name: sheet.name,
      column_mapping: mapping,
      event_year_choice: yearChoice,
      default_owner_id: defaultOwnerId,
      total_rows: plan.rows.length,
    },
  });
  if (batchError) return dbErrorResponse(batchError);
  const batchId = (batch as { id: string }).id;

  // Keep the original file (private bucket, server-only access). Failure here doesn't block the import.
  try {
    const path = `${batchId}/${file.name.replace(/[^\w.\- ]+/g, "_")}`;
    const admin = createAdminClient();
    const { error: uploadError } = await admin.storage
      .from("import-files")
      .upload(path, Buffer.from(buffer), { contentType: file.type || "application/octet-stream", upsert: true });
    if (!uploadError) await supabase.rpc("import_set_storage_path", { p_batch_id: batchId, p_path: path });
    else console.warn("Import file upload failed", uploadError.message);
  } catch (error) {
    console.warn("Import file upload skipped", error);
  }

  const rows = buildStagedRows(plan);

  // Rows are staged in one call (≤ 1,000); processing then runs in recoverable chunks.
  const { error: stageError } = await supabase.rpc("import_stage_rows", { p_batch_id: batchId, p_rows: rows });
  if (stageError) return dbErrorResponse(stageError);

  return NextResponse.json({ ok: true, batchId, existing: false, summary: plan.summary });
}
