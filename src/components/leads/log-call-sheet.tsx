"use client";

import { useState } from "react";
import { logCall } from "@/actions/leads";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { InlineAlert } from "@/components/ui/states";
import { formatDue } from "@/lib/domain/format";
import { CALL_OUTCOMES, type CallOutcome } from "@/lib/domain/labels";
import { defaultPurpose } from "@/lib/domain/schedule";
import { stageLabel, suggestedStageAfterCall } from "@/lib/domain/stages";
import { useOnOpen, usePersistentDraft, useRequestId } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { TimePicker, type TimeChoice } from "./time-picker";
import { useRunAction } from "./use-run-action";

export type CallTarget = {
  id: string;
  customer_name: string;
  stage: string;
  version: number;
  dueFollowUp?: { id: string; purpose: string; due_at: string } | null;
};

/** Outcome + note + next follow-up (+ optional stage move) saved together in one step. */
export function LogCallSheet({
  lead,
  open,
  onOpenChange,
  userId,
  prompted,
}: {
  lead: CallTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  prompted?: boolean;
}) {
  const run = useRunAction();
  const [requestId, rotateRequestId] = useRequestId();
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [note, setNote, clearNote] = usePersistentDraft(open ? `draft:${userId}:call:${lead.id}` : null);
  const [time, setTime] = useState<TimeChoice>({ key: "none", at: null });
  const [purposeText, setPurpose] = useState("");
  const [purposeTouched, setPurposeTouched] = useState(false);
  const [completeDue, setCompleteDue] = useState(true);
  const [moveStage, setMoveStage] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useOnOpen(open, () => {
    setOutcome(null);
    setTime({ key: "none", at: null });
    setPurposeTouched(false);
    setCompleteDue(true);
    setMoveStage(true);
    setError(null);
  });
  const purpose = purposeTouched ? purposeText : defaultPurpose(outcome);

  const suggestion = outcome ? suggestedStageAfterCall(lead.stage, outcome) : null;

  async function save() {
    if (!outcome) {
      setError("Choose how the call went.");
      return;
    }
    if (time.key !== "none" && !time.at) {
      setError("Pick a follow-up date and time.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await run(
      () =>
        logCall({
          requestId,
          leadId: lead.id,
          version: lead.version,
          outcome,
          note,
          followUp: time.at ? { dueAt: time.at.toISOString(), purpose: purpose.trim() || defaultPurpose(outcome) } : null,
          newStage: suggestion && moveStage ? suggestion : null,
          completeFollowUpId: lead.dueFollowUp && completeDue ? lead.dueFollowUp.id : null,
        }),
      { success: "Call logged", quietValidation: true },
    );
    setSaving(false);
    if (result.ok) {
      clearNote();
      rotateRequestId();
      onOpenChange(false);
    } else if (result.code === "validation") {
      setError(result.message);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !saving && onOpenChange(next)}
      title={prompted ? "How did the call go?" : "Log a call"}
      description={lead.customer_name}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save call
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">Outcome</legend>
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {CALL_OUTCOMES.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={outcome === o.value}
                onClick={() => setOutcome(o.value)}
                className={cn(
                  "min-h-11 rounded-xl border px-3 py-2 text-left text-[13px] font-medium transition-colors",
                  outcome === o.value ? "border-fg bg-fg text-canvas" : "border-line bg-surface hover:bg-hover",
                  o.value === "callback_requested" && "col-span-2",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </fieldset>

        <Field label="Note" htmlFor="call-note" hint="Saved on this device until the call is logged.">
          <Textarea
            id="call-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What did you discuss? Menu, budget, guest count…"
            rows={3}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium">Next follow-up</p>
          <TimePicker idPrefix="call" value={time} onChange={setTime} allowNone />
          {time.key !== "none" ? (
            <Input
              aria-label="Follow-up purpose"
              value={purpose}
              onChange={(e) => {
                setPurposeTouched(true);
                setPurpose(e.target.value);
              }}
              placeholder="Purpose, e.g. Share veg menu options"
              maxLength={500}
            />
          ) : null}
        </div>

        {lead.dueFollowUp || suggestion ? (
          <div className="flex flex-col gap-3 rounded-xl bg-subtle p-3.5">
            {lead.dueFollowUp ? (
              <label className="flex items-start gap-3 text-sm">
                <Checkbox checked={completeDue} onChange={(e) => setCompleteDue(e.target.checked)} className="mt-0.5" />
                <span>
                  Mark follow-up done: <span className="font-medium">{lead.dueFollowUp.purpose}</span>
                  <span className="block text-[13px] text-fg-muted">Due {formatDue(lead.dueFollowUp.due_at)}</span>
                </span>
              </label>
            ) : null}
            {suggestion ? (
              <label className="flex items-start gap-3 text-sm">
                <Checkbox checked={moveStage} onChange={(e) => setMoveStage(e.target.checked)} className="mt-0.5" />
                <span>
                  Move stage from {stageLabel(lead.stage)} to <span className="font-medium">{stageLabel(suggestion)}</span>
                </span>
              </label>
            ) : null}
          </div>
        ) : null}
        <p className="text-xs text-fg-subtle">
          Only what you record here counts as a call. Tapping Call is tracked separately as a dial attempt.
        </p>
      </div>
    </Sheet>
  );
}
