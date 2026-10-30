"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { handoffLead } from "@/actions/pipeline";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { InlineAlert } from "@/components/ui/states";
import { PHASES, phaseLabel, type Phase } from "@/lib/domain/stages";
import { useOnOpen, useRequestId } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { useRunAction } from "../use-run-action";

export type Requirement = { label: string; met: boolean };

export type DeskMember = { id: string; full_name: string; desk: Phase | null };

/**
 * Push a lead to another desk. Salespeople push to the next desk; managers can pick any desk and,
 * optionally, the person. The note is required: it's what the next desk reads first.
 */
export function HandoffSheet({
  lead,
  toPhase: initialPhase,
  choosePhase,
  requirements,
  members,
  open,
  onOpenChange,
  onEditDetails,
}: {
  lead: { id: string; version: number; customer_name: string; phase: string };
  toPhase: Phase;
  /** Managers: allow any desk (except operations, which is Confirm booking). */
  choosePhase?: boolean;
  /** Requirements for the chosen desk, keyed by desk. */
  requirements: Partial<Record<Phase, Requirement[]>>;
  /** Managers: people they can hand the lead to directly. */
  members?: DeskMember[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditDetails?: () => void;
}) {
  const run = useRunAction();
  const [requestId, rotate] = useRequestId();
  const [toPhase, setToPhase] = useState<Phase>(initialPhase);
  const [note, setNote] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useOnOpen(open, () => {
    setToPhase(initialPhase);
    setNote("");
    setOwnerId("");
    setError(null);
  });

  const reqs = requirements[toPhase] ?? [];
  const missing = reqs.filter((r) => !r.met);
  const deskPeople = members?.filter((m) => m.desk === toPhase) ?? [];

  async function save() {
    if (!note.trim()) return setError("Add a note for the next desk: what the customer wants and what was agreed.");
    setSaving(true);
    setError(null);
    const result = await run(
      () => handoffLead({ requestId, leadId: lead.id, version: lead.version, toPhase, note, ownerId: ownerId || null }),
      { quietValidation: true },
    );
    setSaving(false);
    if (result.ok) {
      rotate();
      onOpenChange(false);
      toast.success(`Handed to ${phaseLabel(result.data.phase)}`, { description: result.data.owner_name ? `Now with ${result.data.owner_name}` : undefined });
    } else if (result.code === "validation" || result.code === "forbidden") {
      setError(result.message);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !saving && onOpenChange(next)}
      title={`Hand to ${phaseLabel(toPhase)}`}
      description={lead.customer_name}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={missing.length > 0}>
            Hand over
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

        {choosePhase ? (
          <Field label="Desk" htmlFor="handoff-desk">
            <Select id="handoff-desk" value={toPhase} onChange={(e) => setToPhase(e.target.value as Phase)}>
              {PHASES.filter((p) => p.value !== "operations" && p.value !== lead.phase).map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {reqs.length ? (
          <div className="rounded-xl bg-subtle p-3.5">
            <p className="mb-2 text-sm font-medium">{missing.length ? "Needed before handing over" : "Ready to hand over"}</p>
            <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
              {reqs.map((r) => (
                <li key={r.label} className={cn("flex items-center gap-2", r.met ? "text-fg" : "text-fg-muted")}>
                  {r.met ? <Check className="size-4 text-success" /> : <X className="size-4 text-danger" />}
                  {r.label}
                </li>
              ))}
            </ul>
            {missing.length && onEditDetails ? (
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                onClick={() => {
                  onOpenChange(false);
                  onEditDetails();
                }}
              >
                Fill in details
              </Button>
            ) : null}
          </div>
        ) : null}

        <Field label="Note for the next desk" htmlFor="handoff-note" required hint="What the customer wants, what was agreed, and the best time to call.">
          <Textarea id="handoff-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} />
        </Field>

        {members ? (
          <Field label="Give to" htmlFor="handoff-owner" hint={deskPeople.length ? undefined : "Nobody is on this desk yet. Set desks on the Team page."}>
            <Select id="handoff-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Next in turn on the desk</option>
              {deskPeople.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
    </Sheet>
  );
}
