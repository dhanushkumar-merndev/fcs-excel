"use client";

import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import type { WorkloadRow } from "@/lib/domain/types";
import type { YearChoice } from "@/lib/import/dates";
import type { PreparedImport } from "@/lib/import/prepare";

export function ConfirmStep({
  plan,
  fileName,
  workload,
  ownerId,
  onOwner,
  yearChoice,
}: {
  plan: PreparedImport;
  fileName: string;
  workload: WorkloadRow[];
  ownerId: string;
  onOwner: (id: string) => void;
  yearChoice: YearChoice;
}) {
  const s = plan.summary;
  const lines: [string, number, string?][] = [
    ["New leads to create", s.toCreate, "text-fg font-semibold"],
    ["…of which flagged for review", s.needsReview],
    ["Skipped — already imported or repeated in file", s.skippedExact],
    ["Skipped — your duplicate decisions", s.skippedByChoice],
    ["Excluded — invalid rows", s.invalid],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card className="p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold">Summary</h2>
        <p className="mt-0.5 text-sm text-fg-muted">{fileName}</p>
        <dl className="mt-4 divide-y divide-line">
          {lines.map(([label, value, cls]) => (
            <div key={label} className="flex items-center justify-between py-2.5 text-sm">
              <dt className="text-fg-muted">{label}</dt>
              <dd className={`tabular ${cls ?? ""}`}>{value.toLocaleString("en-IN")}</dd>
            </div>
          ))}
          <div className="flex items-center justify-between py-2.5 text-sm font-medium">
            <dt>Total data rows</dt>
            <dd className="tabular">{s.total.toLocaleString("en-IN")}</dd>
          </div>
        </dl>
        <p className="mt-4 text-[13px] text-fg-muted">
          {yearChoice.mode === "unresolved"
            ? "Dates without a year are imported as “Date needs review”."
            : yearChoice.mode === "fixed"
              ? `Dates without a year use ${yearChoice.year}.`
              : "Dates without a year use the next occurrence after each lead's creation date."}{" "}
          The server checks every row again before saving. Re-running this import never creates extra leads.
        </p>
      </Card>
      <Card className="p-4 sm:p-5">
        <Field label="Assign new leads to" htmlFor="import-owner" hint="You can also assign later, individually or in bulk.">
          <Select id="import-owner" value={ownerId} onChange={(e) => onOwner(e.target.value)}>
            <option value="">Leave unassigned (queue)</option>
            {workload
              .filter((w) => w.is_active)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.full_name} — {w.open_leads} open, {w.overdue_follow_ups} overdue
                </option>
              ))}
          </Select>
        </Field>
      </Card>
    </div>
  );
}
