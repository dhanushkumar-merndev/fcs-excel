"use client";

import { useState } from "react";
import { createFollowUp, rescheduleFollowUp } from "@/actions/leads";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { InlineAlert } from "@/components/ui/states";
import { formatDue } from "@/lib/domain/format";
import { useOnOpen, useRequestId } from "@/lib/hooks";
import { TimePicker, type TimeChoice } from "./time-picker";
import { useRunAction } from "./use-run-action";

export function FollowUpSheet({
  leadId,
  leadName,
  open,
  onOpenChange,
  assignees,
  defaultAssigneeId,
  reschedule,
}: {
  leadId: string;
  leadName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Provided for managers/admins who may pick the responsible person. */
  assignees?: { id: string; full_name: string }[];
  defaultAssigneeId?: string | null;
  reschedule?: { id: string; version: number; purpose: string; due_at: string } | null;
}) {
  const run = useRunAction();
  const [requestId, rotate] = useRequestId();
  const [time, setTime] = useState<TimeChoice>({ key: "", at: null });
  const [purpose, setPurpose] = useState("");
  const [reason, setReason] = useState("");
  const [assignee, setAssignee] = useState(defaultAssigneeId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useOnOpen(open, () => {
    setTime({ key: "", at: null });
    setPurpose(reschedule?.purpose ?? "");
    setReason("");
    setAssignee(defaultAssigneeId ?? "");
    setError(null);
  });

  async function save() {
    if (!time.at) return setError("Choose when to follow up.");
    if (!reschedule && !purpose.trim()) return setError("Add a short purpose.");
    setSaving(true);
    setError(null);
    const result = await run(
      () =>
        reschedule
          ? rescheduleFollowUp({ requestId, id: reschedule.id, version: reschedule.version, dueAt: time.at!.toISOString(), reason })
          : createFollowUp({ requestId, leadId, dueAt: time.at!.toISOString(), purpose, assigneeId: assignee || null }),
      { success: reschedule ? "Follow-up rescheduled" : "Follow-up scheduled", quietValidation: true },
    );
    setSaving(false);
    if (result.ok) {
      rotate();
      onOpenChange(false);
    } else if (result.code === "validation") {
      setError(result.message);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !saving && onOpenChange(next)}
      title={reschedule ? "Reschedule follow-up" : "Schedule follow-up"}
      description={leadName}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            {reschedule ? "Reschedule" : "Schedule"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        {reschedule ? (
          <p className="text-sm text-fg-muted">
            <span className="font-medium text-fg">{reschedule.purpose}</span> · currently due {formatDue(reschedule.due_at)}
          </p>
        ) : (
          <Field label="Purpose" htmlFor="fu-purpose" required>
            <Input
              id="fu-purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="e.g. Send revised quote"
              maxLength={500}
            />
          </Field>
        )}
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium">When</p>
          <TimePicker idPrefix="fu" value={time} onChange={setTime} />
        </div>
        {reschedule ? (
          <Field label="Reason (optional)" htmlFor="fu-reason">
            <Input id="fu-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer travelling" maxLength={300} />
          </Field>
        ) : assignees?.length ? (
          <Field label="Responsible" htmlFor="fu-assignee" hint="Defaults to the lead owner.">
            <Select id="fu-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Lead owner</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
    </Sheet>
  );
}
