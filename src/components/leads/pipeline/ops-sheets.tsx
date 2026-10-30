"use client";

import { useState } from "react";
import { opsUpdate } from "@/actions/pipeline";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { InlineAlert } from "@/components/ui/states";
import { useOnOpen, useRequestId } from "@/lib/hooks";
import { useRunAction } from "../use-run-action";

type OpsLead = {
  id: string;
  version: number;
  customer_name: string;
  chef_name: string | null;
  chef_phone: string | null;
  ops_notes: string | null;
};

/** BDE 4: who is cooking, how to reach them, and anything operations needs to know. */
export function ChefSheet({ lead, open, onOpenChange }: { lead: OpsLead; open: boolean; onOpenChange: (open: boolean) => void }) {
  const run = useRunAction();
  const [requestId, rotate] = useRequestId();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useOnOpen(open, () => {
    setName(lead.chef_name ?? "");
    setPhone(lead.chef_phone ?? "");
    setNotes(lead.ops_notes ?? "");
    setError(null);
  });

  async function save() {
    if (!name.trim()) return setError("Enter the chef's name.");
    setSaving(true);
    setError(null);
    const result = await run(
      () => opsUpdate({ requestId, leadId: lead.id, version: lead.version, action: "chef", chefName: name, chefPhone: phone, opsNotes: notes }),
      { quietValidation: true, success: lead.chef_name ? "Chef details updated" : "Chef assigned" },
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
      title={lead.chef_name ? "Chef & operations" : "Assign chef"}
      description={lead.customer_name}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {error ? <InlineAlert tone="danger" className="sm:col-span-2">{error}</InlineAlert> : null}
        <Field label="Chef" htmlFor="chef-name" required>
          <Input id="chef-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
        </Field>
        <Field label="Chef's phone" htmlFor="chef-phone">
          <Input id="chef-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
        </Field>
        <Field label="Operations notes" htmlFor="ops-notes" className="sm:col-span-2" hint="Menu, arrival time, equipment, helpers, anything the event team needs.">
          <Textarea id="ops-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </Field>
      </div>
    </Sheet>
  );
}

/** BDE 4: the event happened. Optional closing note for the record. */
export function CompleteEventSheet({ lead, open, onOpenChange }: { lead: OpsLead; open: boolean; onOpenChange: (open: boolean) => void }) {
  const run = useRunAction();
  const [requestId, rotate] = useRequestId();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useOnOpen(open, () => {
    setNote("");
    setError(null);
  });

  async function save() {
    setSaving(true);
    setError(null);
    const result = await run(() => opsUpdate({ requestId, leadId: lead.id, version: lead.version, action: "complete", note }), {
      quietValidation: true,
      success: "Event marked completed",
    });
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
      title="Mark event completed"
      description={lead.customer_name}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Mark completed
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        <Field label="How did it go? (optional)" htmlFor="complete-note" hint="Feedback, issues, anything to follow up on.">
          <Textarea id="complete-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} />
        </Field>
      </div>
    </Sheet>
  );
}
