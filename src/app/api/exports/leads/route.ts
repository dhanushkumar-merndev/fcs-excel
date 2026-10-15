import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireApiStaff } from "@/lib/api";
import { formatDateTime } from "@/lib/domain/format";
import { guestRangeLabel, humanizeCode, platformLabel, reviewFlagLabel } from "@/lib/domain/labels";
import { can } from "@/lib/domain/permissions";
import { stageLabel } from "@/lib/domain/stages";
import { buildCsv, buildWorkbook, fileResponse, type SheetSpec } from "@/lib/export/sheet";
import { normalizeHeader, TEMPLATE_COLUMNS } from "@/lib/import/template";
import { parseListState, SORTS, toRpcFilters, type LeadFilters } from "@/lib/leads/filters";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

type ExportLead = Record<string, unknown> & {
  id: string;
  source_raw: Record<string, string> | null;
  owner: { full_name: string } | null;
  batch: { file_name: string; created_at: string } | null;
};

const SELECT =
  "*, owner:profiles!leads_owner_id_fkey(full_name), batch:import_batches!leads_import_batch_id_fkey(file_name, created_at)";

/**
 * Exports leads under the caller's own permissions (RLS). scope=selected exports exactly the
 * given IDs; scope=filtered exports every lead matching the filters — never just the visible page.
 */
export async function GET(request: NextRequest) {
  const staff = await requireApiStaff(request);
  if (staff instanceof NextResponse) return staff;
  const supabase = await createClient();
  const { data: settings } = await supabase.from("business_settings").select("salesperson_export_enabled").eq("id", 1).maybeSingle();
  if (!can(staff.role, "export", { salespersonExportEnabled: settings?.salesperson_export_enabled })) {
    return jsonError("Exporting is turned off for your role.", 403);
  }

  const sp = request.nextUrl.searchParams;
  const format = sp.get("format") === "csv" ? "csv" : "xlsx";
  const layout = sp.get("layout") === "source" ? "source" : "crm";
  const scope = sp.get("scope") === "selected" ? "selected" : "filtered";
  const state = parseListState(sp);
  let filters: LeadFilters = state.filters;
  if (scope === "selected") {
    const ids = (sp.get("ids") ?? "").split(",").filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 1000);
    if (!ids.length) return jsonError("No leads selected.", 400);
    filters = { ids };
  }

  const rows: ExportLead[] = [];
  const sort = SORTS[state.sort];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .rpc("search_leads", { p_filters: toRpcFilters(filters) })
      .select(SELECT)
      .order(sort.column, { ascending: state.dir === "asc", nullsFirst: false })
      .order("lead_number", { ascending: false })
      .range(from, from + 999);
    if (error) return jsonError("Couldn't load leads for export.", 500);
    rows.push(...((data ?? []) as unknown as ExportLead[]));
    if (!data || data.length < 1000) break;
    if (rows.length >= 50_000) break;
  }

  const origin = request.nextUrl.origin;
  const sheet = layout === "source" ? sourceSheet(rows) : crmSheet(rows, origin);
  const stamp = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const scopeLabel = scope === "selected" ? `selected-${rows.length}` : `all-matching-${rows.length}`;
  const fileName = `leads-${layout === "source" ? "template-" : ""}${scopeLabel}-${stamp}.${format}`;

  await supabase.rpc("record_export", {
    p_scope: scope,
    p_format: format,
    p_layout: layout,
    p_row_count: rows.length,
    p_filters: filters,
  });

  if (format === "csv") return fileResponse(buildCsv(sheet), fileName, "csv");

  const info: SheetSpec = {
    name: "Export info",
    columns: [
      { header: "Field", type: "text", width: 22 },
      { header: "Value", type: "text", width: 90 },
    ],
    rows: [
      ["Contents", scope === "selected" ? `Selected rows only (${rows.length})` : `Full filtered result (${rows.length} leads), not just one page`],
      ["Layout", layout === "source" ? "Original import template columns (re-import safe: existing source IDs are skipped)" : "CRM export"],
      ["Filters", scope === "selected" ? "Selected lead IDs" : describeFilters(filters, state.view)],
      ["Exported by", `${staff.fullName} (${staff.email})`],
      ["Exported at", `${formatDateTime(new Date())} IST`],
      ["Notes", "Phone numbers and IDs are stored as text. Dates are real Excel dates. Values starting with = or @ are prefixed with ' to prevent formulas."],
    ],
  };
  return fileResponse(buildWorkbook([sheet, info]), fileName, "xlsx");
}

function describeFilters(filters: LeadFilters, view: string | null) {
  const parts = Object.entries(filters)
    .filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  return [view ? `view=${view}` : null, ...parts].filter(Boolean).join("; ") || "No filters (all leads you can access)";
}

function crmSheet(rows: ExportLead[], origin: string): SheetSpec {
  const v = (r: ExportLead, k: string) => (r[k] ?? null) as string | number | boolean | null;
  return {
    name: "Leads",
    columns: [
      { header: "Lead #", type: "text", width: 9 },
      { header: "Customer name", type: "text", width: 24 },
      { header: "Phone", type: "text", width: 16 },
      { header: "Phone (original)", type: "text", width: 18 },
      { header: "Stage", type: "text", width: 16 },
      { header: "Closed reason", type: "text", width: 24 },
      { header: "Priority", type: "text", width: 9 },
      { header: "Owner", type: "text", width: 18 },
      { header: "Occasion", type: "text", width: 16 },
      { header: "Menu", type: "text", width: 14 },
      { header: "Guests", type: "text", width: 12 },
      { header: "Event date", type: "date", width: 13 },
      { header: "Event date (original text)", type: "text", width: 18 },
      { header: "Event date status", type: "text", width: 14 },
      { header: "Event address", type: "text", width: 32 },
      { header: "Next follow-up (IST)", type: "datetime", width: 18 },
      { header: "First logged call (IST)", type: "datetime", width: 18 },
      { header: "Last activity (IST)", type: "datetime", width: 18 },
      { header: "Quoted amount (INR)", type: "number", width: 14 },
      { header: "Booking value (INR)", type: "number", width: 14 },
      { header: "Source", type: "text", width: 14 },
      { header: "Platform", type: "text", width: 12 },
      { header: "Campaign", type: "text", width: 28 },
      { header: "Campaign ID", type: "text", width: 22 },
      { header: "Ad set", type: "text", width: 24 },
      { header: "Ad set ID", type: "text", width: 22 },
      { header: "Ad", type: "text", width: 24 },
      { header: "Ad ID", type: "text", width: 22 },
      { header: "Form", type: "text", width: 22 },
      { header: "Form ID", type: "text", width: 22 },
      { header: "Organic", type: "text", width: 9 },
      { header: "Source lead ID", type: "text", width: 24 },
      { header: "Source ID possibly damaged", type: "text", width: 12 },
      { header: "Original status", type: "text", width: 12 },
      { header: "Legacy CRM marker", type: "text", width: 12 },
      { header: "Lead created (original, IST)", type: "datetime", width: 20 },
      { header: "Added to CRM (IST)", type: "datetime", width: 18 },
      { header: "Import file", type: "text", width: 26 },
      { header: "Import row", type: "number", width: 10 },
      { header: "Review flags", type: "text", width: 26 },
      { header: "Lead link", type: "text", width: 44 },
    ],
    rows: rows.map((r) => [
      `L-${r.lead_number}`,
      v(r, "customer_name"),
      v(r, "phone_e164"),
      v(r, "phone_raw"),
      stageLabel(r.stage as string),
      v(r, "closed_reason"),
      v(r, "priority"),
      r.owner?.full_name ?? "Unassigned",
      r.occasion_code ? humanizeCode(r.occasion_code as string) : null,
      r.menu_code ? humanizeCode(r.menu_code as string) : null,
      r.guest_range ? guestRangeLabel(r.guest_range as string) : null,
      v(r, "event_date"),
      v(r, "event_date_raw"),
      v(r, "event_date_status"),
      v(r, "event_address"),
      v(r, "next_follow_up_at"),
      v(r, "first_call_logged_at"),
      v(r, "last_activity_at"),
      v(r, "quoted_amount_inr"),
      v(r, "booking_value_inr"),
      r.source_system === "manual" ? "Manual" : "Meta lead form",
      r.platform ? platformLabel(r.platform as string) : null,
      v(r, "campaign_name"),
      v(r, "campaign_id"),
      v(r, "adset_name"),
      v(r, "adset_id"),
      v(r, "ad_name"),
      v(r, "ad_id"),
      v(r, "form_name"),
      v(r, "form_id"),
      r.is_organic === null || r.is_organic === undefined ? null : r.is_organic ? "TRUE" : "FALSE",
      (r.external_lead_id ?? r.external_lead_id_raw ?? null) as string | null,
      r.external_id_damaged ? "Yes" : null,
      v(r, "source_status"),
      v(r, "legacy_crm_update"),
      v(r, "source_created_at"),
      v(r, "created_at"),
      r.batch?.file_name ?? null,
      v(r, "import_row_number"),
      ((r.review_flags as string[]) ?? []).map(reviewFlagLabel).join(", ") || null,
      `${origin}/leads/${r.id}`,
    ]),
  };
}

/** Exactly the 21 template columns, using the preserved original values where available. */
function sourceSheet(rows: ExportLead[]): SheetSpec {
  const fallback = (r: ExportLead, key: string): string | null => {
    switch (key) {
      case "id":
        return (r.external_lead_id ?? r.external_lead_id_raw ?? null) as string | null;
      case "created_time":
        return (r.source_created_at ?? r.created_at ?? null) as string | null;
      case "ad_id":
      case "ad_name":
      case "adset_id":
      case "adset_name":
      case "campaign_id":
      case "campaign_name":
      case "form_id":
      case "form_name":
      case "platform":
        return (r[key] ?? null) as string | null;
      case "is_organic":
        return r.is_organic === null || r.is_organic === undefined ? null : String(r.is_organic);
      case "occasion":
        return (r.occasion_code ?? null) as string | null;
      case "guests":
        return (r.guest_range ?? null) as string | null;
      case "menu":
        return (r.menu_code ?? null) as string | null;
      case "event_date":
        return (r.event_date ?? r.event_date_raw ?? null) as string | null;
      case "event_address":
        return (r.event_address ?? null) as string | null;
      case "full_name":
        return r.customer_name as string;
      case "phone":
        return (r.phone_raw ?? r.phone_e164) as string;
      case "lead_status":
        return (r.source_status ?? null) as string | null;
      case "crm_update":
        return (r.legacy_crm_update ?? null) as string | null;
      default:
        return null;
    }
  };
  return {
    name: "Leads",
    columns: TEMPLATE_COLUMNS.map((c) => ({ header: c.header, type: "text" as const, width: Math.max(14, c.header.length + 2) })),
    rows: rows.map((r) => {
      const raw = r.source_raw ?? {};
      const byHeader = new Map(Object.entries(raw).map(([k, val]) => [normalizeHeader(k), val]));
      return TEMPLATE_COLUMNS.map((c) => {
        const original = byHeader.get(normalizeHeader(c.header));
        return original !== undefined && original !== "" ? original : fallback(r, c.key);
      });
    }),
  };
}
