"use client";

import { useState } from "react";
import { updateLeadDetails } from "@/actions/leads";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { InlineAlert } from "@/components/ui/states";
import { humanizeCode } from "@/lib/domain/labels";
import type { LeadRow } from "@/lib/domain/types";
import { useOnOpen, useRequestId } from "@/lib/hooks";
import { useRunAction } from "../use-run-action";

type Form = {
  customer_name: string;
  phone: string;
  occasion_code: string;
  menu_code: string;
  guest_range: string;
  event_date: string;
  event_address: string;
  priority: "low" | "normal" | "high";
  quoted_amount_inr: string;
  booking_value_inr: string;
};

function fromLead(lead: LeadRow): Form {
  return {
    customer_name: lead.customer_name,
    phone: lead.phone_e164,
    occasion_code: lead.occasion_code ? humanizeCode(lead.occasion_code) : "",
    menu_code: lead.menu_code ? humanizeCode(lead.menu_code) : "",
    guest_range: lead.guest_range ?? "",
    event_date: lead.event_date ?? "",
    event_address: lead.event_address ?? "",
    priority: lead.priority,
    quoted_amount_inr: lead.quoted_amount_inr === null ? "" : String(lead.quoted_amount_inr),
    booking_value_inr: lead.booking_value_inr === null ? "" : String(lead.booking_value_inr),
  };
}

export function EditDetailsSheet({ lead, open, onOpenChange }: { lead: LeadRow; open: boolean; onOpenChange: (open: boolean) => void }) {
  const run = useRunAction();
  const [requestId, rotate] = useRequestId();
  const [form, setForm] = useState<Form>(() => fromLead(lead));
  const [initial, setInitial] = useState<Form>(() => fromLead(lead));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useOnOpen(open, () => {
    const f = fromLead(lead);
    setForm(f);
    setInitial(f);
    setError(null);
  });

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(form) as (keyof Form)[]) {
      if (form[key] !== initial[key]) patch[key] = form[key] === "" ? null : form[key];
    }
    if (patch.customer_name === null) return setError("Name can't be empty.");
    if (patch.phone === null) return setError("Phone can't be empty.");
    if (!Object.keys(patch).length) return onOpenChange(false);
    setSaving(true);
    setError(null);
    const result = await run(
      () => updateLeadDetails({ requestId, leadId: lead.id, version: lead.version, patch: patch as never }),
      { success: "Details saved", quietValidation: true },
    );
    setSaving(false);
    if (result.ok) {
      rotate();
      onOpenChange(false);
    } else if (result.code === "validation" || result.code === "conflict") {
      setError(result.message);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !saving && onOpenChange(next)}
      title="Edit details"
      description="Important changes are recorded in the activity timeline."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save details
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {error ? <InlineAlert tone="danger" className="sm:col-span-2">{error}</InlineAlert> : null}
        <Field label="Customer name" htmlFor="ed-name" required>
          <Input id="ed-name" value={form.customer_name} onChange={(e) => set("customer_name", e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Phone" htmlFor="ed-phone" required hint="Indian numbers can be entered without +91.">
          <Input id="ed-phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Occasion" htmlFor="ed-occasion">
          <Input id="ed-occasion" value={form.occasion_code} onChange={(e) => set("occasion_code", e.target.value)} placeholder="e.g. House Party" />
        </Field>
        <Field label="Menu" htmlFor="ed-menu">
          <Input id="ed-menu" value={form.menu_code} onChange={(e) => set("menu_code", e.target.value)} placeholder="e.g. Veg Menu" />
        </Field>
        <Field label="Guests" htmlFor="ed-guests" hint="Keep as a range, e.g. 11-20.">
          <Input id="ed-guests" value={form.guest_range} onChange={(e) => set("guest_range", e.target.value)} />
        </Field>
        <Field
          label="Event date"
          htmlFor="ed-date"
          hint={lead.event_date_status === "needs_review" && lead.event_date_raw ? `Original text: “${lead.event_date_raw}”` : undefined}
        >
          <Input id="ed-date" type="date" value={form.event_date} onChange={(e) => set("event_date", e.target.value)} />
        </Field>
        <Field label="Event address" htmlFor="ed-address" className="sm:col-span-2">
          <Textarea id="ed-address" rows={2} value={form.event_address} onChange={(e) => set("event_address", e.target.value)} />
        </Field>
        <Field label="Priority" htmlFor="ed-priority">
          <Select id="ed-priority" value={form.priority} onChange={(e) => set("priority", e.target.value as Form["priority"])}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </Select>
        </Field>
        <Field label="Quoted amount (INR)" htmlFor="ed-quote">
          <Input id="ed-quote" inputMode="decimal" value={form.quoted_amount_inr} onChange={(e) => set("quoted_amount_inr", e.target.value.replace(/[^\d.]/g, ""))} />
        </Field>
        <Field label="Booking value (INR)" htmlFor="ed-booking" hint="Only used for booked-value reporting.">
          <Input id="ed-booking" inputMode="decimal" value={form.booking_value_inr} onChange={(e) => set("booking_value_inr", e.target.value.replace(/[^\d.]/g, ""))} />
        </Field>
      </div>
    </Sheet>
  );
}
