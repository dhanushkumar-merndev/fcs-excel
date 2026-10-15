"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { changeStage, updateLeadDetails } from "@/actions/leads";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { InlineAlert } from "@/components/ui/states";
import { STAGES, isClosedStage, requiresReason, stageLabel } from "@/lib/domain/stages";
import { useRequestId } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { StageBadge } from "./badges";
import { useRunAction } from "./use-run-action";

export function StageSheet({
  lead,
  pendingFollowUps,
  open,
  onOpenChange,
  lostReasons,
  unqualifiedReasons,
}: {
  lead: { id: string; stage: string; version: number; customer_name: string };
  pendingFollowUps: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lostReasons: string[];
  unqualifiedReasons: string[];
}) {
  const run = useRunAction();
  const [requestId, rotate] = useRequestId();
  const [stage, setStage] = useState(lead.stage);
  const [reasonChoice, setReasonChoice] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [pendingAction, setPendingAction] = useState<"cancel" | "complete" | "keep" | "">("");
  const [bookingValue, setBookingValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStage(lead.stage);
    setReasonChoice("");
    setReasonText("");
    setPendingAction("");
    setBookingValue("");
    setError(null);
  }, [open, lead.stage]);

  const closing = isClosedStage(stage) && stage !== lead.stage;
  const reopening = isClosedStage(lead.stage) && !isClosedStage(stage);
  const needsReason = requiresReason(stage) && stage !== lead.stage;
  const reasons = stage === "lost" ? lostReasons : stage === "unqualified" ? unqualifiedReasons : [];
  const reason = reasonChoice && reasonChoice !== "Other" ? (reasonText.trim() ? `${reasonChoice}: ${reasonText.trim()}` : reasonChoice) : reasonText.trim();
  const needsPendingChoice = closing && pendingFollowUps > 0;

  async function save() {
    if (stage === lead.stage) return onOpenChange(false);
    if (needsReason && !reason) return setError("Choose or write a reason.");
    if (needsPendingChoice && !pendingAction) return setError("Choose what happens to the pending follow-ups.");
    setSaving(true);
    setError(null);
    const result = await run(
      () =>
        changeStage({
          requestId,
          leadId: lead.id,
          version: lead.version,
          stage,
          reason: reason || null,
          pendingAction: needsPendingChoice ? (pendingAction as "cancel" | "complete" | "keep") : null,
        }),
      { quietValidation: true },
    );
    if (result.ok && stage === "booked" && bookingValue.trim()) {
      await run(() =>
        updateLeadDetails({
          requestId: crypto.randomUUID(),
          leadId: lead.id,
          version: result.data.version,
          patch: { booking_value_inr: bookingValue },
        }),
      );
    }
    setSaving(false);
    if (result.ok) {
      rotate();
      onOpenChange(false);
      toast.success(`Stage updated to ${stageLabel(stage)}`);
    } else if (result.code === "validation" || result.code === "pending_follow_ups") {
      setError(result.message);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !saving && onOpenChange(next)}
      title="Update stage"
      description={lead.customer_name}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={stage === lead.stage}>
            {reopening ? "Reopen lead" : "Update stage"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        <div role="radiogroup" aria-label="Stage" className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {STAGES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={stage === s.value}
              onClick={() => {
                setStage(s.value);
                setError(null);
              }}
              className={cn(
                "flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                stage === s.value ? "border-fg ring-1 ring-fg" : "border-line hover:bg-hover",
              )}
            >
              <StageBadge stage={s.value} />
              {s.value === lead.stage ? <span className="text-xs text-fg-subtle">Current</span> : null}
            </button>
          ))}
        </div>

        {needsReason ? (
          <div className="flex flex-col gap-3">
            <Field label={`Reason for ${stageLabel(stage)}`} htmlFor="stage-reason" required>
              <Select id="stage-reason" value={reasonChoice} onChange={(e) => setReasonChoice(e.target.value)}>
                <option value="">Choose a reason…</option>
                {reasons.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
                {reasons.includes("Other") ? null : <option value="Other">Other</option>}
              </Select>
            </Field>
            <Input
              aria-label="Reason details"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder={reasonChoice === "Other" || !reasonChoice ? "Describe the reason" : "Add details (optional)"}
              maxLength={300}
            />
          </div>
        ) : null}

        {reopening ? (
          <Field label="Why is this lead being reopened? (optional)" htmlFor="reopen-reason">
            <Input id="reopen-reason" value={reasonText} onChange={(e) => setReasonText(e.target.value)} maxLength={300} />
          </Field>
        ) : null}

        {stage === "booked" && closing ? (
          <Field label="Booking value (INR, optional)" htmlFor="booking-value" hint="Used only for booked-value reporting.">
            <Input id="booking-value" inputMode="decimal" value={bookingValue} onChange={(e) => setBookingValue(e.target.value.replace(/[^\d.]/g, ""))} placeholder="e.g. 45000" />
          </Field>
        ) : null}

        {needsPendingChoice ? (
          <fieldset className="rounded-xl bg-subtle p-3.5">
            <legend className="sr-only">Pending follow-ups</legend>
            <p className="mb-2.5 text-sm font-medium">
              {pendingFollowUps} pending follow-up{pendingFollowUps === 1 ? "" : "s"}
            </p>
            <div className="flex flex-col gap-2 text-sm">
              {(
                [
                  ["cancel", "Cancel them", "Recorded as cancelled with this reason."],
                  ["complete", "Mark them done", "Recorded as completed now."],
                  ...(stage === "booked" ? [["keep", "Keep them", "Useful for event preparation tasks."]] : []),
                ] as [typeof pendingAction, string, string][]
              ).map(([value, label, hint]) => (
                <label key={value} className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="pending-action"
                    className="mt-1 accent-[var(--fg)]"
                    checked={pendingAction === value}
                    onChange={() => setPendingAction(value)}
                  />
                  <span>
                    {label}
                    <span className="block text-[13px] text-fg-muted">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </div>
    </Sheet>
  );
}
