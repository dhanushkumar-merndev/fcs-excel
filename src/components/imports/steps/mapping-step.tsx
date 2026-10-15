"use client";

import { Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { cellText } from "@/lib/import/cells";
import type { ParsedSheet } from "@/lib/import/parse";
import { autoMapHeaders, REQUIRED_KEYS, TEMPLATE_COLUMNS, type ColumnMapping } from "@/lib/import/template";
import { cn } from "@/lib/utils";

export function MappingStep({
  sheet,
  mapping,
  onChange,
}: {
  sheet: ParsedSheet;
  mapping: ColumnMapping;
  onChange: (m: ColumnMapping) => void;
}) {
  const auto = autoMapHeaders(sheet.headers);
  const used = new Set(Object.values(mapping).filter(Boolean));
  const unmapped = sheet.headers.filter((h) => !used.has(h));
  const sample = (header: string | null | undefined) => {
    if (!header) return "";
    for (const row of sheet.rows.slice(0, 20)) {
      const t = cellText(row.cells[header]).trim();
      if (t) return t;
    }
    return "";
  };
  const autoCount = TEMPLATE_COLUMNS.filter((c) => mapping[c.key] && mapping[c.key] === auto[c.key]).length;

  return (
    <Card>
      <div className="flex flex-col gap-1 border-b border-line px-4 py-4 sm:px-5">
        <h2 className="text-[15px] font-semibold">Match columns</h2>
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
              <p className="truncate text-[13px] text-fg-muted" title={sample(header)}>
                {header ? sample(header) || <span className="text-fg-subtle">empty in first rows</span> : required ? <span className="text-danger">Required</span> : ""}
              </p>
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
