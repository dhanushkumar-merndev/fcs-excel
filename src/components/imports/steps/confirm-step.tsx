"use client";

import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import type { WorkloadRow } from "@/lib/domain/types";
import type { YearChoice } from "@/lib/import/dates";
import type { PreparedImport, summarizeBySheet } from "@/lib/import/prepare";

export function ConfirmStep({
  plan,
  fileName,
  sheets,
  workload,
  ownerId,
  onOwner,
  yearChoice,
}: {
  plan: PreparedImport;
  fileName: string;
  /** Per-sheet breakdown when several sheets are imported together. */
  sheets?: ReturnType<typeof summarizeBySheet>;
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
        {sheets ? (
          <div className="mt-4 overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-subtle text-left text-xs text-fg-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Sheet</th>
                  <th className="px-3 py-2 text-right font-medium">New</th>
                  <th className="px-3 py-2 text-right font-medium">Skipped</th>
                  <th className="px-3 py-2 text-right font-medium">Invalid</th>
                </tr>
              </thead>
              <tbody>
                {sheets.map((s) => (
                  <tr key={s.sheet} className="border-t border-line">
                    <td className="max-w-48 truncate px-3 py-2">{s.sheet.trim()}</td>
                    <td className="tabular px-3 py-2 text-right font-medium">{s.toCreate.toLocaleString("en-IN")}</td>
                    <td className="tabular px-3 py-2 text-right text-fg-muted">{s.skipped.toLocaleString("en-IN")}</td>
                    <td className="tabular px-3 py-2 text-right text-fg-muted">{s.invalid.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="mt-4 text-[13px] text-fg-muted">
          {sheets ? "Each sheet is saved as its own import, in this order — leads repeated in a later sheet are skipped and linked. " : ""}
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
