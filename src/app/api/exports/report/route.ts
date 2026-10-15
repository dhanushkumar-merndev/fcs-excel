import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireApiStaff } from "@/lib/api";
import { formatDateTime } from "@/lib/domain/format";
import { callOutcomeLabel, humanizeCode, platformLabel } from "@/lib/domain/labels";
import { can } from "@/lib/domain/permissions";
import { stageLabel } from "@/lib/domain/stages";
import { buildWorkbook, fileResponse, type SheetSpec } from "@/lib/export/sheet";
import { toRpcFilters } from "@/lib/leads/filters";
import { AGEING_BUCKETS, cohortFilters, fillDays, parseReportParams, type ReportData } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";

/** The report as a workbook, computed with the same RPC (and permissions) as the Reports page. */
export async function GET(request: NextRequest) {
  const staff = await requireApiStaff(request);
  if (staff instanceof NextResponse) return staff;
  const supabase = await createClient();
  const { data: settings } = await supabase.from("business_settings").select("salesperson_export_enabled").eq("id", 1).maybeSingle();
  if (!can(staff.role, "export", { salespersonExportEnabled: settings?.salesperson_export_enabled })) {
    return jsonError("Exporting is turned off for your role.", 403);
  }
  const params = parseReportParams(request.nextUrl.searchParams);
  const { data, error } = await supabase.rpc("report_overview", { p_filters: toRpcFilters(cohortFilters(params)) });
  if (error) return jsonError("Couldn't build the report.", 500);
  const r = data as ReportData;
  const c = r.cohort;
  const a = r.activity;

  const breakdown = (name: string, rows: { value: string; leads: number; booked: number }[], label: (v: string) => string): SheetSpec => ({
    name,
    columns: [
      { header: name, type: "text", width: 36 },
      { header: "Leads (cohort)", type: "number" },
      { header: "Booked", type: "number" },
      { header: "Conversion %", type: "number" },
    ],
    rows: rows.map((x) => [label(x.value), x.leads, x.booked, x.leads ? Math.round((x.booked / x.leads) * 1000) / 10 : null]),
  });

  const sheets: SheetSpec[] = [
    {
      name: "Summary",
      columns: [
        { header: "Metric", type: "text", width: 44 },
        { header: "Value", type: "text", width: 30 },
        { header: "Definition", type: "text", width: 90 },
      ],
      rows: [
        ["Scope", staff.role === "salesperson" ? "Personal" : staff.role === "manager" ? "Team-wide" : "Business-wide", ""],
        ["Date range (IST)", `${params.from} to ${params.to}`, ""],
        ["Filters", [params.owner && `salesperson=${params.owner}`, params.campaign && `campaign=${params.campaign}`, params.platform && `platform=${params.platform}`, params.stage && `stage=${params.stage}`].filter(Boolean).join("; ") || "None", ""],
        ["Leads in cohort", c.total, "Leads whose original creation time falls in the range. Skipped duplicate imports excluded."],
        ["Booked", c.booked, "Cohort leads currently in stage Booked."],
        ["Lost", c.lost, ""],
        ["Unqualified", c.unqualified, ""],
        ["Open", c.open, ""],
        ["Conversion rate %", c.total ? Math.round((c.booked / c.total) * 1000) / 10 : "—", "Booked leads ÷ leads in the acquisition cohort."],
        ["Median hours to first logged call", c.median_hours_to_first_call ?? "—", "From CRM entry to the first call recorded with an outcome."],
        ["75th percentile hours to first logged call", c.p75_hours_to_first_call ?? "—", ""],
        ["Logged calls (activity)", a.calls_by_outcome.reduce((s, x) => s + x.calls, 0), "Calls recorded with an outcome during the range."],
        ["Dial taps (activity)", a.dial_taps, "Call button taps during the range. Not calls."],
        ["Follow-ups completed (activity)", a.follow_ups_completed, ""],
        ["Marked booked (activity)", a.booked_in_period, "Leads moved to Booked during the range, whenever they were created."],
        ["Overdue follow-ups (now)", r.snapshot.overdue_follow_ups, ""],
        ["Generated", `${formatDateTime(r.generated_at)} IST`, ""],
      ].map((row) => row.map((v) => (typeof v === "number" ? String(v) : v))),
    },
    {
      name: "Leads by day",
      columns: [
        { header: "Date (original creation)", type: "date", width: 16 },
        { header: "Leads", type: "number" },
        { header: "Booked", type: "number" },
      ],
      rows: fillDays(params.from, params.to, c.by_day, (day) => ({ day, leads: 0, booked: 0 })).map((d) => [d.day, d.leads, d.booked]),
    },
    {
      name: "By stage",
      columns: [
        { header: "Stage", type: "text", width: 20 },
        { header: "Leads", type: "number" },
      ],
      rows: c.by_stage.map((s) => [stageLabel(s.stage), s.leads]),
    },
    {
      name: "By salesperson",
      columns: [
        { header: "Owner", type: "text", width: 24 },
        { header: "Leads", type: "number" },
        { header: "Open", type: "number" },
        { header: "Booked", type: "number" },
        { header: "Lost + unqualified", type: "number" },
      ],
      rows: c.by_owner.map((o) => [o.name, o.leads, o.open, o.booked, o.lost]),
    },
    breakdown("Campaign", c.by_campaign, (v) => v || "(No campaign)"),
    breakdown("Ad", c.by_ad, (v) => v || "(No ad)"),
    breakdown("Platform", c.by_platform, (v) => (v ? platformLabel(v) : "(Unknown)")),
    breakdown("Occasion", c.by_occasion, (v) => (v ? humanizeCode(v) : "(Not given)")),
    {
      name: "Lead ageing",
      columns: [
        { header: "Days since created (open leads)", type: "text", width: 30 },
        { header: "Leads", type: "number" },
      ],
      rows: AGEING_BUCKETS.map((b) => [b.label, c.ageing[b.key]]),
    },
    {
      name: "Call outcomes",
      columns: [
        { header: "Outcome", type: "text", width: 30 },
        { header: "Logged calls", type: "number" },
        { header: "Leads", type: "number" },
      ],
      rows: a.calls_by_outcome.map((x) => [callOutcomeLabel(x.outcome), x.calls, x.leads]),
    },
    {
      name: "Imports by day",
      columns: [
        { header: "Date added to CRM", type: "date", width: 16 },
        { header: "Leads imported", type: "number" },
      ],
      rows: fillDays(params.from, params.to, a.imported_by_day, (day) => ({ day, leads: 0 })).map((d) => [d.day, d.leads]),
    },
  ];
  return fileResponse(buildWorkbook(sheets), `report-${params.from}-to-${params.to}.xlsx`, "xlsx");
}
