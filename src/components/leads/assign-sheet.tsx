"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { assignLeads, assignMatchingLeads } from "@/actions/leads";
import { Avatar } from "@/components/shell/user-menu";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { InlineAlert } from "@/components/ui/states";
import { ROLE_LABELS } from "@/lib/domain/labels";
import type { WorkloadRow } from "@/lib/domain/types";
import { useRequestId } from "@/lib/hooks";
import { cn, pluralize } from "@/lib/utils";
import { useRunAction } from "./use-run-action";

export type AssignScope =
  | { kind: "ids"; ids: string[]; currentOwnerId?: string | null }
  | { kind: "filters"; filters: Record<string, unknown>; count: number };

/** Manual assignment with each person's live workload. Pending follow-ups move with the lead. */
export function AssignSheet({
  scope,
  workload,
  open,
  onOpenChange,
  onDone,
}: {
  scope: AssignScope;
  workload: WorkloadRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const run = useRunAction();
  const [requestId, rotate] = useRequestId();
  const [owner, setOwner] = useState<string | "unassigned" | "">("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = scope.kind === "ids" ? scope.ids.length : scope.count;

  useEffect(() => {
    if (open) {
      setOwner("");
      setReason("");
      setError(null);
    }
  }, [open]);

  async function save() {
    if (!owner) return setError("Choose who should own the lead.");
    setSaving(true);
    setError(null);
    const ownerId = owner === "unassigned" ? null : owner;
    const result = await run(
      () =>
        scope.kind === "ids"
          ? assignLeads({ requestId, leadIds: scope.ids, ownerId, reason })
          : assignMatchingLeads({ requestId, filters: scope.filters, ownerId, reason, expectedCount: scope.count }),
      { quietValidation: true },
    );
    setSaving(false);
    if (result.ok) {
      rotate();
      const name = ownerId ? workload.find((w) => w.id === ownerId)?.full_name : "the unassigned queue";
      toast.success(
        result.data.updated > 0
          ? `${pluralize(result.data.updated, "lead")} assigned to ${name}`
          : "No changes — already assigned",
        result.data.unchanged > 0 && result.data.updated > 0 ? { description: `${result.data.unchanged} already had this owner.` } : undefined,
      );
      onOpenChange(false);
      onDone?.();
    } else if (result.code === "validation" || result.code === "conflict") {
      setError(result.message);
    }
  }

  const people = workload.filter((w) => w.is_active);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !saving && onOpenChange(next)}
      title={count === 1 ? "Assign lead" : `Assign ${count.toLocaleString("en-IN")} leads`}
      description={
        scope.kind === "filters"
          ? `All ${count.toLocaleString("en-IN")} leads matching the current filters`
          : "Pending follow-ups move to the new owner. Completed work keeps its original attribution."
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={!owner}>
            Assign
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        <div role="radiogroup" aria-label="New owner" className="flex flex-col gap-1.5">
          {people.map((p) => {
            const current = scope.kind === "ids" && scope.currentOwnerId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={owner === p.id}
                onClick={() => setOwner(p.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                  owner === p.id ? "border-fg ring-1 ring-fg" : "border-line hover:bg-hover",
                )}
              >
                <Avatar name={p.full_name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {p.full_name}
                    {current ? <span className="ml-1.5 text-xs font-normal text-fg-subtle">Current owner</span> : null}
                  </span>
                  <span className="block text-xs text-fg-subtle">{ROLE_LABELS[p.role]}</span>
                </span>
                <span className="tabular flex shrink-0 flex-col items-end text-xs text-fg-muted">
                  <span>{p.open_leads} open</span>
                  <span className={p.overdue_follow_ups > 0 ? "text-danger" : undefined}>{p.overdue_follow_ups} overdue</span>
                </span>
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={owner === "unassigned"}
            onClick={() => setOwner("unassigned")}
            className={cn(
              "rounded-xl border border-dashed px-3 py-2.5 text-left text-sm transition-colors",
              owner === "unassigned" ? "border-fg ring-1 ring-fg" : "border-line-strong text-fg-muted hover:bg-hover",
            )}
          >
            Move to unassigned queue
          </button>
        </div>
        <Field label="Note for the history (optional)" htmlFor="assign-reason">
          <Input id="assign-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Covering while Anil is on leave" maxLength={300} />
        </Field>
      </div>
    </Sheet>
  );
}
