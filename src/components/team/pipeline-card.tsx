"use client";

import { Workflow } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { updatePipeline } from "@/actions/pipeline";
import { useRunAction } from "@/components/leads/use-run-action";
import { Avatar } from "@/components/shell/user-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/states";
import { PHASES, type Phase } from "@/lib/domain/stages";
import type { PipelineInfo } from "@/lib/leads/queries";
import { useSyncedState } from "@/lib/hooks";

/**
 * BDE pipeline setup (admin; managers see it read-only): which salesperson sits on which desk, the
 * first-call target, and the switch. Each desk shares its leads among its people in turn.
 */
export function PipelineCard({ info, canEdit }: { info: PipelineInfo; canEdit: boolean }) {
  const run = useRunAction();
  const savedDesks = JSON.stringify(Object.fromEntries(info.members.map((m) => [m.id, m.desk])));
  const [enabled, setEnabled] = useSyncedState(info.enabled);
  const [sla, setSla] = useSyncedState(String(info.slaMinutes));
  const [desksJson, setDesksJson] = useSyncedState(savedDesks);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const desks = JSON.parse(desksJson) as Record<string, Phase | null>;
  const dirty = enabled !== info.enabled || sla !== String(info.slaMinutes) || desksJson !== savedDesks;
  const empty = PHASES.filter((p) => !info.members.some((m) => desks[m.id] === p.value && m.in_round_robin));
  const name = (id: string | null) => info.members.find((m) => m.id === id)?.full_name;

  async function save() {
    setSaving(true);
    setError(null);
    const result = await run(() => updatePipeline({ enabled, desks, slaMinutes: sla }), { quietValidation: true });
    setSaving(false);
    if (result.ok) toast.success(enabled ? "BDE pipeline saved" : "BDE pipeline is off");
    else if (result.code === "validation") setError(result.message);
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Workflow className="size-4 text-fg-muted" /> BDE pipeline
            <Badge tint={info.enabled ? "green" : "gray"}>{info.enabled ? "On" : "Off"}</Badge>
          </span>
        }
        description="Four desks, each with its own people. New leads go to BDE 1, who calls them and pushes interested ones to BDE 2. BDE 2 qualifies them for BDE 3, who closes the booking once the advance is in, and BDE 4 runs the event. Each desk shares its leads among its people in turn."
      />
      <CardBody className="flex flex-col gap-4">
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {PHASES.map((p) => {
            const people = info.members.filter((m) => desks[m.id] === p.value);
            return (
              <div key={p.value} className="rounded-xl border border-line p-3">
                <p className="text-sm font-semibold">{p.label}</p>
                <p className="mb-2 text-[13px] text-fg-muted">{p.job}</p>
                {people.length ? (
                  <ul className="flex flex-col gap-1 text-sm">
                    {people.map((m) => (
                      <li key={m.id} className="flex items-center gap-2">
                        <Avatar name={m.full_name} className="size-6 text-[10px]" />
                        <span className="min-w-0 flex-1 truncate">{m.full_name}</span>
                        {!m.in_round_robin ? (
                          <span className="text-xs text-fg-subtle">Left out</span>
                        ) : info.enabled && info.next[p.value] === m.id ? (
                          <Badge tint="blue">Next</Badge>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-tint-amber-fg">Nobody yet</p>
                )}
              </div>
            );
          })}
        </div>

        {canEdit ? (
          <>
            {info.members.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-fg-muted">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Salesperson</th>
                      <th className="px-2 py-1.5 font-medium">Desk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {info.members.map((m) => (
                      <tr key={m.id} className="border-t border-line">
                        <td className="px-2 py-2">
                          <span className="flex items-center gap-2">
                            <Avatar name={m.full_name} className="size-7 text-[11px]" />
                            <span className="truncate">{m.full_name}</span>
                          </span>
                        </td>
                        <td className="w-56 px-2 py-2">
                          <Select
                            aria-label={`Desk for ${m.full_name}`}
                            value={desks[m.id] ?? ""}
                            onChange={(e) => setDesksJson(JSON.stringify({ ...desks, [m.id]: (e.target.value || null) as Phase | null }))}
                          >
                            <option value="">Not on a desk</option>
                            {PHASES.map((p) => (
                              <option key={p.value} value={p.value}>
                                {p.label}
                              </option>
                            ))}
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-fg-muted">No active salespeople yet. Add one with “Add member”.</p>
            )}

            <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-subtle px-4 py-3">
                <Checkbox className="mt-0.5" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                <span>
                  <span className="font-medium">Run leads through the four desks</span>
                  <span className="block text-[13px] text-fg-muted">
                    {enabled && empty.length
                      ? `Put someone on ${empty.map((p) => p.short).join(", ")} first.`
                      : "Off: leads work as before, shared among all salespeople. Turning it off again changes no data."}
                  </span>
                </span>
              </label>
              <Field label="First call within (minutes)" htmlFor="sla-minutes" hint="BDE 1's first-call target after a lead arrives.">
                <Input id="sla-minutes" inputMode="numeric" value={sla} onChange={(e) => setSla(e.target.value.replace(/\D/g, ""))} />
              </Field>
            </div>

            <div className="flex justify-end border-t border-line pt-4">
              <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
                Save pipeline
              </Button>
            </div>
          </>
        ) : info.enabled ? (
          <p className="text-[13px] text-fg-muted">
            Next on each desk:{" "}
            {PHASES.map((p) => `${p.short} ${name(info.next[p.value]) ?? "—"}`).join(" · ")}. Only an admin can change desks.
          </p>
        ) : (
          <p className="text-[13px] text-fg-muted">Only an admin can set up desks and switch the pipeline on.</p>
        )}
      </CardBody>
    </Card>
  );
}
