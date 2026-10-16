"use client";

import { ArrowRight, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { formatCalendarDate, formatDateTime, formatPhone } from "@/lib/domain/format";
import { guestRangeLabel, humanizeCode, platformLabel } from "@/lib/domain/labels";
import { cellText, type RawRow } from "@/lib/import/cells";
import { normalizeRow, type NormalizedLead } from "@/lib/import/normalize";
import type { ParsedSheet } from "@/lib/import/parse";
import { autoMapHeaders, REQUIRED_KEYS, TEMPLATE_COLUMNS, type ColumnMapping, type TemplateKey } from "@/lib/import/template";
import { cn } from "@/lib/utils";

/** How the CRM will store a sample value, shown next to the original so the cleaning is visible. */
function cleanedValue(key: TemplateKey, lead: NormalizedLead): string | null {
  switch (key) {
    case "phone":
      return lead.phone_e164 ? formatPhone(lead.phone_e164) : "Invalid — see Clean & validate";
    case "platform":
      return lead.platform ? platformLabel(lead.platform) : null;
    case "is_organic":
      return lead.is_organic === null ? null : lead.is_organic ? "Yes" : "No";
    case "occasion":
      return lead.occasion_code ? humanizeCode(lead.occasion_code) : null;
    case "menu":
      return lead.menu_code ? humanizeCode(lead.menu_code) : null;
    case "guests":
      return lead.guest_range ? guestRangeLabel(lead.guest_range) : null;
    case "event_date":
      return lead.event_date ? formatCalendarDate(lead.event_date) : lead.event_date_raw ? "Needs a year or review" : null;
    case "created_time":
      return lead.source_created_at ? `${formatDateTime(lead.source_created_at)} IST` : "Unreadable";
    case "lead_status":
      return lead.source_status?.toUpperCase() === "CREATED" ? "Stage: New" : null;
    default:
      return null;
  }
}

export function MappingStep({
  sheet,
  title,
  mapping,
  onChange,
}: {
  sheet: ParsedSheet;
  /** Sheet name, shown when several sheets are matched one after another. */
  title?: string;
  mapping: ColumnMapping;
  onChange: (m: ColumnMapping) => void;
}) {
  const auto = autoMapHeaders(sheet.headers, sheet.rows);
  const used = new Set(Object.values(mapping).filter(Boolean));
  const unmapped = sheet.headers.filter((h) => !used.has(h));
  const sampleRow = (header: string): RawRow | undefined => sheet.rows.slice(0, 20).find((row) => cellText(row.cells[header]).trim());
  const sample = (key: TemplateKey, header: string | null | undefined) => {
    if (!header) return null;
    const row = sampleRow(header);
    if (!row) return null;
    const raw = cellText(row.cells[header]).trim();
    const cleaned = cleanedValue(key, normalizeRow(row, mapping, { mode: "unresolved" }).lead);
    return { raw, cleaned: cleaned && cleaned !== raw ? cleaned : null };
  };
  const autoCount = TEMPLATE_COLUMNS.filter((c) => mapping[c.key] && mapping[c.key] === auto[c.key]).length;

  return (
    <Card>
      <div className="flex flex-col gap-1 border-b border-line px-4 py-4 sm:px-5">
        <h2 className="text-[15px] font-semibold">{title ? `Match columns · ${title}` : "Match columns"}</h2>
        <p className="text-sm text-fg-muted">
          {autoCount} of {TEMPLATE_COLUMNS.length} columns matched automatically. Header row: spreadsheet row {sheet.headerRow}. Correct any
          mapping below.
        </p>
      </div>
      <div className="divide-y divide-line">
        {TEMPLATE_COLUMNS.map((col) => {
          const header = mapping[col.key] ?? null;
          const required = REQUIRED_KEYS.includes(col.key);
          return (
            <div key={col.key} className="grid gap-2 px-4 py-3 sm:grid-cols-[220px_1fr_1fr] sm:items-center sm:px-5">
              <div>
                <p className="text-sm font-medium">
                  {col.label}
                  {required ? <span className="text-danger"> *</span> : null}
                </p>
                <p className="font-mono text-xs text-fg-subtle">{col.header}</p>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  aria-label={`File column for ${col.label}`}
                  value={header ?? ""}
                  onChange={(e) => onChange({ ...mapping, [col.key]: e.target.value || null })}
                  className={cn(required && !header && "border-danger")}
                  wrapperClassName="flex-1"
                >
                  <option value="">— Not in this file —</option>
                  {sheet.headers.map((h) => (
                    <option key={h} value={h} disabled={used.has(h) && h !== header}>
                      {h}
                    </option>
                  ))}
                </Select>
                {header && header === auto[col.key] ? (
                  <span title="Matched automatically" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-tint-green text-tint-green-fg">
                    <Check className="size-3.5" />
                  </span>
                ) : (
                  <span className="size-6 shrink-0" />
                )}
              </div>
              <SampleCell value={sample(col.key, header)} mapped={Boolean(header)} required={required} />
            </div>
          );
        })}
      </div>
      {unmapped.length ? (
        <p className="border-t border-line px-4 py-3 text-[13px] text-fg-muted sm:px-5">
          Not mapped (kept in each lead&apos;s original row): {unmapped.join(", ")}
        </p>
      ) : null}
    </Card>
  );
}

function SampleCell({ value, mapped, required }: { value: { raw: string; cleaned: string | null } | null; mapped: boolean; required: boolean }) {
  if (!mapped) return <p className="text-[13px]">{required ? <span className="text-danger">Required</span> : null}</p>;
  if (!value) return <p className="text-[13px] text-fg-subtle">empty in first rows</p>;
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-[13px]" title={value.cleaned ? `${value.raw} → ${value.cleaned}` : value.raw}>
      <span className="truncate text-fg-muted">{value.raw}</span>
      {value.cleaned ? (
        <>
          <ArrowRight aria-label="becomes" className="size-3.5 shrink-0 text-fg-subtle" />
          <span className="truncate font-medium text-fg">{value.cleaned}</span>
        </>
      ) : null}
    </p>
  );
}
