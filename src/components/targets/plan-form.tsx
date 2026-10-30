"use client";

import { useState } from "react";
import { saveSalesTarget } from "@/actions/pipeline";
import { useRunAction } from "@/components/leads/use-run-action";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/states";
import { formatINR } from "@/lib/domain/format";
import { SCENARIOS, targetFunnel, type TargetPlan } from "@/lib/domain/targets";
import { useSyncedState } from "@/lib/hooks";

const FIELDS: { key: keyof TargetPlan; label: string; hint?: string; suffix?: string }[] = [
  { key: "leadsPerDay", label: "Leads per day" },
  { key: "workingDays", label: "Working days" },
  { key: "pushRate", label: "BDE 1 → BDE 2", hint: "Leads pushed on as interested", suffix: "%" },
  { key: "qualificationRate", label: "BDE 2 qualified", hint: "Of leads BDE 2 receives", suffix: "%" },
  { key: "closingRate", label: "BDE 3 booked", hint: "Of qualified leads, advance paid", suffix: "%" },
  { key: "chefMixPct", label: "Chef on Demand share", hint: "Of bookings; the rest are Catering", suffix: "%" },
  { key: "chefTicket", label: "Chef on Demand ticket", hint: "Average, INR" },
  { key: "cateringTicket", label: "Catering ticket", hint: "Average, INR" },
];

/** The month's plan, with the target funnel and revenue it implies, recalculated as you type. */
export function PlanForm({ month, plan, saved, canEdit }: { month: string; plan: TargetPlan; saved: boolean; canEdit: boolean }) {
  const run = useRunAction();
  const initial = JSON.stringify(plan);
  const [json, setJson] = useSyncedState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = JSON.parse(json) as Record<keyof TargetPlan, string | number>;
  const numeric = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, Number(v) || 0])) as TargetPlan;
  const f = targetFunnel(numeric);
  const dirty = json !== initial;

  async function save() {
    setSaving(true);
    setError(null);
    const result = await run(() => saveSalesTarget({ month, ...numeric }), { quietValidation: true, success: "Targets saved" });
    setSaving(false);
    if (!result.ok && result.code === "validation") setError(result.message);
  }

  return (
    <Card>
      <CardHeader
        title="Monthly plan"
        description={saved ? "Saved for this month." : "Not saved for this month yet — showing the standard planning scenario."}
        action={
          canEdit ? (
            <Button size="sm" onClick={() => void save()} loading={saving} disabled={!dirty && saved}>
              Save targets
            </Button>
          ) : null
        }
      />
      <CardBody className="flex flex-col gap-4">
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {FIELDS.map((field) => (
            <Field key={field.key} label={`${field.label}${field.suffix ? ` (${field.suffix})` : ""}`} htmlFor={`plan-${field.key}`} hint={field.hint}>
              <Input
                id={`plan-${field.key}`}
                inputMode="decimal"
                value={String(draft[field.key])}
                disabled={!canEdit}
                onChange={(e) => setJson(JSON.stringify({ ...draft, [field.key]: e.target.value.replace(/[^\d.]/g, "") }))}
              />
            </Field>
          ))}
        </div>

        <div className="grid gap-2 rounded-xl bg-subtle p-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Figure label="Monthly leads" value={f.leads.toLocaleString("en-IN")} />
          <Figure label="To BDE 2" value={f.pushed.toLocaleString("en-IN")} />
          <Figure label="Qualified" value={f.qualified.toLocaleString("en-IN")} />
          <Figure label="Bookings" value={f.bookings.toLocaleString("en-IN")} sub={`${f.chefBookings} chef · ${f.cateringBookings} catering`} />
          <Figure label="Gross booking revenue" value={formatINR(f.revenue)} sub={`${formatINR(f.chefRevenue)} + ${formatINR(f.cateringRevenue)}`} className="sm:col-span-2" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="mb-2 text-left text-[13px] font-medium text-fg-muted">Scenarios at these rates</caption>
            <thead className="text-left text-xs text-fg-muted">
              <tr>
                <th className="px-2 py-1.5 font-medium">Scenario</th>
                <th className="px-2 py-1.5 text-right font-medium">Leads/day</th>
                <th className="px-2 py-1.5 text-right font-medium">Monthly leads</th>
                <th className="px-2 py-1.5 text-right font-medium">Qualified</th>
                <th className="px-2 py-1.5 text-right font-medium">Bookings</th>
                <th className="px-2 py-1.5 text-right font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {SCENARIOS.map((s) => {
                const r = targetFunnel({ ...numeric, leadsPerDay: s.leadsPerDay });
                return (
                  <tr key={s.key} className="border-t border-line">
                    <td className="px-2 py-2">{s.label}</td>
                    <td className="tabular px-2 py-2 text-right">{s.leadsPerDay}</td>
                    <td className="tabular px-2 py-2 text-right">{r.leads.toLocaleString("en-IN")}</td>
                    <td className="tabular px-2 py-2 text-right">{r.qualified.toLocaleString("en-IN")}</td>
                    <td className="tabular px-2 py-2 text-right">{r.bookings.toLocaleString("en-IN")}</td>
                    <td className="tabular px-2 py-2 text-right">{formatINR(r.revenue)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-fg-subtle">Projections, not guarantees: gross booked value, not profit or cash collected.</p>
        </div>
      </CardBody>
    </Card>
  );
}

function Figure({ label, value, sub, className }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="tabular text-base font-semibold">{value}</p>
      {sub ? <p className="text-xs text-fg-subtle">{sub}</p> : null}
    </div>
  );
}
