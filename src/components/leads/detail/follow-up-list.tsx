"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { cancelFollowUp, completeFollowUp } from "@/actions/leads";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Field, Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { formatDateTime, formatDue } from "@/lib/domain/format";
import type { FollowUpRow, LeadRow } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { FollowUpBadge } from "../badges";
import { FollowUpSheet } from "../follow-up-sheet";
import { useLeadActions } from "../lead-actions";
import { useRunAction } from "../use-run-action";

export type FollowUpWithPeople = FollowUpRow & { assignee: { full_name: string } | null; completer: { full_name: string } | null };

export function FollowUpList({ followUps, lead }: { followUps: FollowUpWithPeople[]; lead: LeadRow }) {
  const actions = useLeadActions();
  const pending = followUps.filter((f) => f.status === "pending");
  const closed = followUps
    .filter((f) => f.status !== "pending")
    .sort((a, b) => (b.completed_at ?? b.cancelled_at ?? "").localeCompare(a.completed_at ?? a.cancelled_at ?? ""));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Pending</h3>
        <Button size="sm" variant="secondary" onClick={() => actions.scheduleFollowUp(lead)}>
          Schedule follow-up
        </Button>
      </div>
      {pending.length ? (
        <ul className="flex flex-col gap-2">
          {pending.map((f) => (
            <FollowUpItem key={f.id} followUp={f} leadName={lead.customer_name} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">No pending follow-ups.</p>
      )}
      {closed.length ? (
        <>
          <h3 className="text-sm font-medium">History</h3>
          <ul className="flex flex-col gap-2">
            {closed.map((f) => (
              <li key={f.id} className="rounded-xl bg-subtle px-3.5 py-3 text-sm">
                <p className={cn(f.status === "cancelled" && "text-fg-muted line-through")}>{f.purpose}</p>
                <p className="mt-0.5 text-xs text-fg-subtle">
                  {f.status === "completed"
                    ? `Completed by ${f.completer?.full_name ?? "someone"} · ${formatDateTime(f.completed_at)}${f.outcome ? ` · ${f.outcome}` : ""}`
                    : `Cancelled · ${formatDateTime(f.cancelled_at)}${f.cancel_reason ? ` · ${f.cancel_reason}` : ""}`}
                </p>
                <p className="text-xs text-fg-subtle">Was due {formatDue(f.due_at)}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export function FollowUpItem({ followUp, leadName, leadLink }: { followUp: FollowUpWithPeople | (FollowUpRow & { assignee?: { full_name: string } | null }); leadName: string; leadLink?: React.ReactNode }) {
  const run = useRunAction();
  const [mode, setMode] = useState<"complete" | "reschedule" | "cancel" | null>(null);
  const [outcome, setOutcome] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function complete() {
    setBusy(true);
    const result = await run(
      () => completeFollowUp({ requestId: crypto.randomUUID(), id: followUp.id, version: followUp.version, outcome }),
      { success: "Follow-up completed" },
    );
    setBusy(false);
    if (result.ok) setMode(null);
  }

  async function cancel() {
    if (!reason.trim()) return;
    setBusy(true);
    const result = await run(
      () => cancelFollowUp({ requestId: crypto.randomUUID(), id: followUp.id, version: followUp.version, reason }),
      { success: "Follow-up cancelled" },
    );
    setBusy(false);
    if (result.ok) setMode(null);
  }

  return (
    <li className="rounded-xl border border-line px-3.5 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {leadLink}
          <FollowUpBadge nextAt={followUp.due_at} />
          <p className="mt-1 text-sm">{followUp.purpose}</p>
          <p className="text-xs text-fg-subtle">Responsible: {followUp.assignee?.full_name ?? "Unassigned"}</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button
            size="sm"
            onClick={() => {
              setOutcome("");
              setMode("complete");
            }}
          >
            <Check /> Done
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setMode("reschedule")}>
            Reschedule
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setReason("");
              setMode("cancel");
            }}
          >
            Cancel
          </Button>
        </div>
      </div>

      <Sheet
        open={mode === "complete"}
        onOpenChange={(o) => !busy && setMode(o ? "complete" : null)}
        title="Complete follow-up"
        description={`${leadName} · ${followUp.purpose}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMode(null)} disabled={busy}>
              Back
            </Button>
            <Button onClick={complete} loading={busy}>
              Mark done
            </Button>
          </>
        }
      >
        <Field label="Outcome (optional)" htmlFor={`fu-outcome-${followUp.id}`}>
          <Input id={`fu-outcome-${followUp.id}`} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="e.g. Sent menu on WhatsApp" maxLength={500} />
        </Field>
      </Sheet>

      <FollowUpSheet
        leadId={followUp.lead_id}
        leadName={leadName}
        open={mode === "reschedule"}
        onOpenChange={(o) => setMode(o ? "reschedule" : null)}
        reschedule={{ id: followUp.id, version: followUp.version, purpose: followUp.purpose, due_at: followUp.due_at }}
      />

      <ConfirmDialog
        open={mode === "cancel"}
        onOpenChange={(o) => !busy && setMode(o ? "cancel" : null)}
        title="Cancel this follow-up?"
        description="It will be recorded as cancelled with your reason."
        confirmLabel="Cancel follow-up"
        loading={busy}
        onConfirm={cancel}
      >
        <Field label="Reason" htmlFor={`fu-cancel-${followUp.id}`} required>
          <Input id={`fu-cancel-${followUp.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer confirmed by WhatsApp" maxLength={300} autoFocus />
        </Field>
      </ConfirmDialog>
    </li>
  );
}
