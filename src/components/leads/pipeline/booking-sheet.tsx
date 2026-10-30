"use client";

import { useState } from "react";
import { toast } from "sonner";
import { confirmBooking } from "@/actions/pipeline";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { InlineAlert } from "@/components/ui/states";
import { formatINR } from "@/lib/domain/format";
import { useOnOpen, useRequestId } from "@/lib/hooks";
import { useRunAction } from "../use-run-action";

/**
 * Booking confirmed = the customer accepted the quotation and the advance is in. The database
 * refuses a booking without a recorded advance; the lead then goes to BDE 4.
 */
export function ConfirmBookingSheet({
  lead,
  advancePaid,
  pendingFollowUps,
  pipelineOn,
  open,
  onOpenChange,
  onRecordAdvance,
}: {
  lead: { id: string; version: number; customer_name: string; quoted_amount_inr: string | number | null };
  advancePaid: number;
  pendingFollowUps: number;
  pipelineOn: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecordAdvance: () => void;
}) {
  const run = useRunAction();
  const [requestId, rotate] = useRequestId();
  const [value, setValue] = useState("");
  const [pendingAction, setPendingAction] = useState<"keep" | "complete" | "cancel">("keep");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useOnOpen(open, () => {
    setValue(lead.quoted_amount_inr === null ? "" : String(Number(lead.quoted_amount_inr)));
    setPendingAction("keep");
    setError(null);
  });

  async function save() {
    if (!(Number(value) > 0)) return setError("Enter the booking value.");
    setSaving(true);
    setError(null);
    const result = await run(
      () =>
        confirmBooking({
          requestId,
          leadId: lead.id,
          version: lead.version,
          bookingValue: value,
          pendingAction: pendingFollowUps > 0 ? pendingAction : null,
        }),
      { quietValidation: true },
    );
    setSaving(false);
    if (result.ok) {
      rotate();
      onOpenChange(false);
      toast.success("Booking confirmed", {
        description: result.data.handed_to_operations
          ? `Handed to ${result.data.owner_name} (BDE 4) for operations.`
          : pipelineOn
            ? "Nobody is on BDE 4 right now, so the booking stays with you."
            : undefined,
      });
    } else if (result.code === "validation" || result.code === "pending_follow_ups") {
      setError(result.message);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !saving && onOpenChange(next)}
      title="Confirm booking"
      description={lead.customer_name}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={advancePaid <= 0}>
            Confirm booking
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        {advancePaid > 0 ? (
          <InlineAlert tone="success" title={`Advance received: ${formatINR(advancePaid)}`}>
            The customer has accepted the quotation and paid the advance.
          </InlineAlert>
        ) : (
          <InlineAlert tone="warning" title="No advance recorded yet">
            A booking counts only once the advance is received.{" "}
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={() => {
                onOpenChange(false);
                onRecordAdvance();
              }}
            >
              Record the advance
            </button>
          </InlineAlert>
        )}
        <Field label="Booking value (INR)" htmlFor="booking-value" required hint="The full value the customer agreed to pay.">
          <Input id="booking-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} />
        </Field>
        {pendingFollowUps > 0 ? (
          <fieldset className="rounded-xl bg-subtle p-3.5">
            <legend className="sr-only">Pending follow-ups</legend>
            <p className="mb-2.5 text-sm font-medium">
              {pendingFollowUps} pending follow-up{pendingFollowUps === 1 ? "" : "s"}
            </p>
            <div className="flex flex-col gap-2 text-sm">
              {(
                [
                  ["keep", "Keep them", "They move to operations with the booking."],
                  ["complete", "Mark them done", "Recorded as completed now."],
                  ["cancel", "Cancel them", "Recorded as cancelled."],
                ] as const
              ).map(([v, label, hint]) => (
                <label key={v} className="flex items-start gap-3">
                  <input type="radio" name="booking-pending" className="mt-1 accent-[var(--fg)]" checked={pendingAction === v} onChange={() => setPendingAction(v)} />
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
