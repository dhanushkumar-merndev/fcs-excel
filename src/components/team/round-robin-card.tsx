"use client";

import { Repeat } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { assignLeadsRoundRobin } from "@/actions/leads";
import { updateRoundRobin } from "@/actions/settings";
import { useRunAction } from "@/components/leads/use-run-action";
import { Avatar } from "@/components/shell/user-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Checkbox } from "@/components/ui/field";
import { useSyncedState } from "@/lib/hooks";
import { cn, pluralize } from "@/lib/utils";

export type RotationMember = { id: string; full_name: string; in_round_robin: boolean };

/**
 * Round robin settings (admin) and "share out the leads that have no owner" (admin and manager).
 * Members are listed in rotation order: the order they joined.
 */
export function RoundRobinCard({
  enabled: savedEnabled,
  members,
  nextId,
  unassignedOpen,
  canEdit,
  pipelineOn = false,
}: {
  enabled: boolean;
  members: RotationMember[];
  nextId: string | null;
  unassignedOpen: number;
  canEdit: boolean;
  /** With the BDE pipeline on, round robin deals only to the BDE 1 desk (and each lead's own desk). */
  pipelineOn?: boolean;
}) {
  const run = useRunAction();
  const savedExcluded = members.filter((m) => !m.in_round_robin).map((m) => m.id);
  const [enabled, setEnabled] = useSyncedState(savedEnabled);
  const [excluded, setExcluded] = useSyncedState(savedExcluded.join(","));
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sharing, setSharing] = useState<{ done: number; total: number } | null>(null);

  const excludedIds = excluded ? excluded.split(",") : [];
  const inRotation = members.filter((m) => !excludedIds.includes(m.id));
  const dirty = enabled !== savedEnabled || excluded !== savedExcluded.join(",");
  const perPerson = inRotation.length ? Math.floor(unassignedOpen / inRotation.length) : 0;

  function toggle(id: string) {
    setExcluded((excludedIds.includes(id) ? excludedIds.filter((x) => x !== id) : [...excludedIds, id]).join(","));
  }

  async function save() {
    setSaving(true);
    const result = await run(() => updateRoundRobin({ enabled, excluded: excludedIds }));
    setSaving(false);
    if (result.ok) toast.success(enabled ? "Round robin saved" : "Round robin turned off");
  }

  /** Shares out every open lead without an owner, 500 per request, until none are left. */
  async function shareOut() {
    setSharing({ done: 0, total: unassignedOpen });
    const totals = new Map<string, number>();
    let done = 0;
    for (;;) {
      const result = await run(() => assignLeadsRoundRobin({ requestId: crypto.randomUUID(), limit: 500 }));
      if (!result.ok) break;
      done += result.data.updated;
      for (const p of result.data.per_owner) totals.set(p.name, (totals.get(p.name) ?? 0) + p.count);
      setSharing({ done, total: done + result.data.remaining });
      if (result.data.remaining === 0 || result.data.updated === 0) {
        toast.success(`${pluralize(done, "lead")} shared out round robin`, {
          description: [...totals].map(([name, n]) => `${name} ${n.toLocaleString("en-IN")}`).join(" · "),
          duration: 10_000,
        });
        break;
      }
    }
    setSharing(null);
    setConfirmOpen(false);
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Repeat className="size-4 text-fg-muted" /> Round robin
            <Badge tint={savedEnabled ? "green" : "gray"}>{savedEnabled ? "On" : "Off"}</Badge>
          </span>
        }
        description={
          pipelineOn
            ? "The BDE pipeline is on: new leads go to the BDE 1 desk in turn, and “Share out” gives each waiting lead to the next person on its own desk."
            : "New leads from Google Sheet sync go to the salespeople in turn. Someone who joins later simply takes their turn from then on — no pile of catch-up leads."
        }
      />
      <CardBody className="flex flex-col gap-4">
        {canEdit ? (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-subtle px-4 py-3">
            <Checkbox className="mt-0.5" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>
              <span className="font-medium">Give new synced leads out round robin</span>
              <span className="block text-[13px] text-fg-muted">Off: they wait unassigned. Imports and new leads can still choose round robin.</span>
            </span>
          </label>
        ) : null}

        {members.length ? (
          <ol className="flex flex-col gap-1.5" aria-label="Rotation order">
            {members.map((m, i) => {
              const included = !excludedIds.includes(m.id);
              return (
                <li key={m.id}>
                  <label
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-xl border border-line px-3 py-2",
                      canEdit ? "cursor-pointer hover:bg-hover" : "cursor-default",
                      !included && "opacity-60",
                    )}
                  >
                    {canEdit ? <Checkbox checked={included} onChange={() => toggle(m.id)} aria-label={`Include ${m.full_name}`} /> : null}
                    <span className="tabular w-5 text-right text-xs text-fg-subtle">{i + 1}</span>
                    <Avatar name={m.full_name} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.full_name}</span>
                    {!included ? (
                      <span className="text-xs text-fg-subtle">Left out</span>
                    ) : m.id === nextId && savedEnabled ? (
                      <Badge tint="blue">Next</Badge>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-fg-muted">No active salespeople yet. Add one with “Add member”.</p>
        )}

        <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-fg-muted">
            {unassignedOpen > 0 ? (
              <>
                <span className="font-medium text-fg">{unassignedOpen.toLocaleString("en-IN")}</span> open {unassignedOpen === 1 ? "lead has" : "leads have"} no owner.
              </>
            ) : (
              "Every open lead has an owner."
            )}
          </p>
          <div className="flex gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
            {canEdit ? (
              <Button variant="secondary" onClick={() => void save()} loading={saving} disabled={!dirty}>
                Save
              </Button>
            ) : null}
            {unassignedOpen > 0 ? (
              <Button onClick={() => setConfirmOpen(true)} disabled={!inRotation.length || dirty}>
                <Repeat /> Share out round robin
              </Button>
            ) : null}
          </div>
        </div>
      </CardBody>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => !sharing && setConfirmOpen(open)}
        title={`Share out ${pluralize(unassignedOpen, "lead")}?`}
        description={
          pipelineOn
            ? "Each goes to the next person on the desk it's at (new leads: BDE 1), oldest enquiry first. Each person gets one notification."
            : `They go to ${inRotation.map((m) => m.full_name).join(", ")} in turn, oldest enquiry first — about ${perPerson.toLocaleString("en-IN")} each. Each person gets one notification.`
        }
        confirmLabel={sharing ? `Sharing… ${sharing.done.toLocaleString("en-IN")} of ${sharing.total.toLocaleString("en-IN")}` : "Share out"}
        tone="primary"
        loading={Boolean(sharing)}
        onConfirm={() => void shareOut()}
      />
    </Card>
  );
}
