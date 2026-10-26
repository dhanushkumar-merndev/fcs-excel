"use client";

import { CalendarDays } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { formatCalendarDate, formatPhone, todayIST } from "@/lib/domain/format";
import { guestRangeLabel, humanizeCode, platformLabel, reviewFlagLabel } from "@/lib/domain/labels";
import { describeDayMonth, eventTiming, type YearChoice } from "@/lib/import/dates";
import type { NormalizedRow } from "@/lib/import/normalize";
import { cn } from "@/lib/utils";

type Filter = "all" | "invalid" | "review" | "clean";
const PAGE = 50;

export function ReviewStep({
  rows,
  yearChoice,
  onYearChoice,
}: {
  rows: NormalizedRow[];
  yearChoice: YearChoice;
  onYearChoice: (c: YearChoice) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const counts = useMemo(
    () => ({
      all: rows.length,
      invalid: rows.filter((r) => !r.valid).length,
      review: rows.filter((r) => r.valid && r.lead.review_flags.length > 0).length,
      clean: rows.filter((r) => r.valid && r.lead.review_flags.length === 0).length,
    }),
    [rows],
  );
  const yearless = rows.filter((r) => r.yearless);
  const shown = rows.filter((r) =>
    filter === "invalid" ? !r.valid : filter === "review" ? r.valid && r.lead.review_flags.length > 0 : filter === "clean" ? r.valid && !r.lead.review_flags.length : true,
  );
  const pageRows = shown.slice(page * PAGE, page * PAGE + PAGE);
  const thisYear = Number(todayIST().slice(0, 4));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Data rows" value={counts.all} />
        <Stat label="Ready" value={counts.clean} tone="green" />
        <Stat label="Import with review flag" value={counts.review} tone="amber" />
        <Stat label="Invalid — excluded" value={counts.invalid} tone={counts.invalid ? "red" : undefined} />
      </div>

      {yearless.length ? (
        <Card className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-tint-amber text-tint-amber-fg">
              <CalendarDays className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-semibold">
                {yearless.length} event date{yearless.length === 1 ? " has" : "s have"} no year
              </h3>
              <p className="mt-0.5 text-sm text-fg-muted">
                Values like “29 October” are never given a year automatically. Choose one for all of them, or import them as “Date needs review”.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select
                  aria-label="Event year for dates without a year"
                  value={yearChoice.mode === "fixed" ? String(yearChoice.year) : yearChoice.mode}
                  onChange={(e) => {
                    const v = e.target.value;
                    onYearChoice(v === "unresolved" ? { mode: "unresolved" } : v === "after_created" ? { mode: "after_created" } : { mode: "fixed", year: Number(v) });
                  }}
                  wrapperClassName="sm:w-96"
                >
                  <option value="unresolved">Leave unresolved — flag “Date needs review”</option>
                  <option value="after_created">Next occurrence after each lead was created (suggested)</option>
                  {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                    <option key={y} value={y}>
                      Use {y} for all
                    </option>
                  ))}
                </Select>
              </div>
              <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-line">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface text-left text-xs text-fg-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Original</th>
                      <th className="px-3 py-2 font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearless.map((r) => (
                      <tr key={r.rowNumber} className="border-t border-line">
                        <td className="tabular px-3 py-1.5 text-fg-muted">
                          <RowCell row={r} />
                        </td>
                        <td className="px-3 py-1.5">“{r.lead.event_date_raw}”</td>
                        <td className="px-3 py-1.5">
                          {r.lead.event_date ? (
                            formatCalendarDate(r.lead.event_date)
                          ) : (
                            <span className="text-tint-amber-fg">
                              {describeDayMonth(r.yearless!.day, r.yearless!.month)} — needs review
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="flex gap-1.5 overflow-x-auto border-b border-line px-3 py-2.5">
          {(
            [
              ["all", "All"],
              ["clean", "Ready"],
              ["review", "Review flags"],
              ["invalid", "Invalid"],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setFilter(key);
                setPage(0);
              }}
              className={cn(
                "h-8 shrink-0 rounded-full px-3 text-[13px] font-medium",
                filter === key ? "bg-fg text-canvas" : "text-fg-muted hover:bg-hover",
              )}
            >
              {label} <span className="tabular opacity-70">{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="text-left text-xs text-fg-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-medium">Row</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2 font-medium">Event date</th>
                <th className="px-3 py-2 font-medium">Occasion · Guests · Menu</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Issues</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.rowNumber} className={cn("border-b border-line align-top last:border-0", !r.valid && "bg-tint-red/40")}>
                  <td className="tabular px-3 py-2 text-fg-muted">
                    <RowCell row={r} />
                  </td>
                  <td className="px-3 py-2">
                    {r.lead.customer_name || <span className="text-danger">Missing</span>}
                    {r.lead.external_lead_id_raw ? (
                      <span className="block font-mono text-[11px] text-fg-subtle">{r.lead.external_lead_id_raw}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {r.lead.phone_e164 ? <span className="tabular">{formatPhone(r.lead.phone_e164)}</span> : <span className="text-danger">Invalid</span>}
                    {r.lead.phone_raw && r.lead.phone_raw !== r.lead.phone_e164 ? (
                      <span className="block text-[11px] text-fg-subtle">was {r.lead.phone_raw}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {r.lead.event_date ? (
                      formatCalendarDate(r.lead.event_date)
                    ) : eventTiming(r.lead.event_date_raw) ? (
                      eventTiming(r.lead.event_date_raw)
                    ) : r.lead.event_date_raw ? (
                      <span className="text-tint-amber-fg">Needs review</span>
                    ) : (
                      "—"
                    )}
                    {r.lead.event_date_raw && r.lead.event_date_raw !== r.lead.event_date ? (
                      <span className="block text-[11px] text-fg-subtle">“{r.lead.event_date_raw}”</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">
                    {[humanizeCode(r.lead.occasion_code), r.lead.guest_range ? guestRangeLabel(r.lead.guest_range) : "—", humanizeCode(r.lead.menu_code)].join(" · ")}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">
                    {platformLabel(r.lead.platform)}
                    {r.lead.is_organic !== null ? <span className="block text-[11px]">{r.lead.is_organic ? "Organic" : "Paid"}</span> : null}
                  </td>
                  <td className="max-w-80 px-3 py-2">
                    <div className="flex flex-col gap-1">
                      {r.issues
                        .filter((i) => i.severity !== "info" || i.code === "year_applied")
                        .map((i, idx) => (
                          <p key={idx} className={cn("text-[12px] leading-snug", i.severity === "error" ? "text-danger" : i.severity === "warning" ? "text-tint-amber-fg" : "text-fg-muted")}>
                            {i.message}
                          </p>
                        ))}
                      {r.valid && r.lead.review_flags.length ? (
                        <span className="flex flex-wrap gap-1">
                          {r.lead.review_flags.map((f) => (
                            <Badge key={f} tint="amber" className="h-5 px-2 text-[11px]">
                              {reviewFlagLabel(f)}
                            </Badge>
                          ))}
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length > PAGE ? (
          <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-sm text-fg-muted">
            <span className="tabular">
              {page * PAGE + 1}–{Math.min(shown.length, (page + 1) * PAGE)} of {shown.length}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="secondary" disabled={(page + 1) * PAGE >= shown.length} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: number; tone?: "green" | "amber" | "red" }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
      <p className="text-xs text-fg-muted">{label}</p>
      <p
        className={cn(
          "tabular mt-0.5 text-2xl font-semibold tracking-tight",
          tone === "green" && "text-tint-green-fg",
          tone === "amber" && "text-tint-amber-fg",
          tone === "red" && "text-danger",
        )}
      >
        {value.toLocaleString("en-IN")}
      </p>
    </div>
  );
}

/** Spreadsheet row, with its sheet when several sheets are previewed together. */
function RowCell({ row }: { row: NormalizedRow }) {
  return (
    <>
      {row.sourceRow ?? row.rowNumber}
      {row.sheet ? <span className="block max-w-28 truncate text-[11px] text-fg-subtle" title={row.sheet}>{row.sheet}</span> : null}
    </>
  );
}
