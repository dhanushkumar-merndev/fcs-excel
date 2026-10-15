"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createLead, findLeadsByPhone } from "@/actions/leads";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/states";
import { formatCalendarDate } from "@/lib/domain/format";
import { MANUAL_CHANNELS } from "@/lib/domain/labels";
import type { WorkloadRow } from "@/lib/domain/types";
import { useRequestId } from "@/lib/hooks";
import { StageBadge } from "./badges";
import { useRunAction } from "./use-run-action";

type Match = { id: string; lead_number: number; customer_name: string; event_date: string | null; stage: string; owner_name: string | null };

export function NewLeadForm({ workload }: { workload: WorkloadRow[] }) {
  const router = useRouter();
  const run = useRunAction();
  const [requestId] = useRequestId();
  const [form, setForm] = useState({
    customerName: "",
    phone: "",
    channel: "phone",
    occasion: "",
    menu: "",
    guestRange: "",
    eventDate: "",
    eventAddress: "",
    priority: "normal" as "low" | "normal" | "high",
    ownerId: "",
    quotedAmount: "",
    note: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    const phone = form.phone.trim();
    if (phone.replace(/\D/g, "").length < 10) {
      setMatches([]);
      return;
    }
    const t = window.setTimeout(async () => {
      const result = await findLeadsByPhone(phone);
      if (result.ok) setMatches(result.data.matches);
    }, 400);
    return () => window.clearTimeout(t);
  }, [form.phone]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!form.customerName.trim()) nextErrors.customerName = "Enter the customer's name.";
    if (!form.phone.trim()) nextErrors.phone = "Enter a phone number.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    setFormError(null);
    const result = await run(
      () =>
        createLead({
          requestId,
          ...form,
          ownerId: form.ownerId || null,
          quotedAmount: form.quotedAmount || null,
        }),
      { success: "Lead created", quietValidation: true },
    );
    setSaving(false);
    if (result.ok) {
      router.push(`/leads/${result.data.id}`);
    } else if (result.code === "validation") {
      setFormError(result.message);
      if (result.fieldErrors) setErrors(Object.fromEntries(Object.entries(result.fieldErrors).map(([k, v]) => [k === "phone" ? "phone" : k, v])));
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card className="p-4 sm:p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          {formError ? <InlineAlert tone="danger" className="sm:col-span-2">{formError}</InlineAlert> : null}
          <Field label="Customer name" htmlFor="nl-name" required error={errors.customerName}>
            <Input id="nl-name" autoComplete="off" value={form.customerName} onChange={(e) => set("customerName", e.target.value)} aria-invalid={Boolean(errors.customerName) || undefined} />
          </Field>
          <Field label="Phone" htmlFor="nl-phone" required error={errors.phone} hint="Indian numbers can be entered without +91.">
            <Input id="nl-phone" type="tel" inputMode="tel" autoComplete="off" value={form.phone} onChange={(e) => set("phone", e.target.value)} aria-invalid={Boolean(errors.phone) || undefined} />
          </Field>

          {matches.length ? (
            <InlineAlert tone="warning" className="sm:col-span-2" title={`This number already has ${matches.length} enquir${matches.length === 1 ? "y" : "ies"}`}>
              <p className="mb-2">Saving creates a separate event enquiry. The existing ones stay unchanged.</p>
              <ul className="flex flex-col gap-1.5">
                {matches.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/leads/${m.id}`} target="_blank" className="font-medium underline underline-offset-2">
                      L-{m.lead_number} · {m.customer_name}
                    </Link>
                    <StageBadge stage={m.stage} />
                    <span className="text-[13px]">
                      Event {m.event_date ? formatCalendarDate(m.event_date) : "date unknown"} · {m.owner_name ?? "Unassigned"}
                    </span>
                  </li>
                ))}
              </ul>
            </InlineAlert>
          ) : null}

          <Field label="How did they reach us?" htmlFor="nl-channel">
            <Select id="nl-channel" value={form.channel} onChange={(e) => set("channel", e.target.value)}>
              {MANUAL_CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Assign to" htmlFor="nl-owner" hint="Leave unassigned to place it in the queue.">
            <Select id="nl-owner" value={form.ownerId} onChange={(e) => set("ownerId", e.target.value)}>
              <option value="">Unassigned</option>
              {workload
                .filter((w) => w.is_active)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.full_name} — {w.open_leads} open, {w.overdue_follow_ups} overdue
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Occasion" htmlFor="nl-occasion">
            <Input id="nl-occasion" value={form.occasion} onChange={(e) => set("occasion", e.target.value)} placeholder="e.g. Birthday, House Party" />
          </Field>
          <Field label="Menu" htmlFor="nl-menu">
            <Input id="nl-menu" value={form.menu} onChange={(e) => set("menu", e.target.value)} placeholder="e.g. Veg Menu" />
          </Field>
          <Field label="Guests" htmlFor="nl-guests" hint="A range is fine, e.g. 11-20.">
            <Input id="nl-guests" value={form.guestRange} onChange={(e) => set("guestRange", e.target.value)} />
          </Field>
          <Field label="Event date" htmlFor="nl-date">
            <Input id="nl-date" type="date" value={form.eventDate} onChange={(e) => set("eventDate", e.target.value)} />
          </Field>
          <Field label="Event address" htmlFor="nl-address" className="sm:col-span-2">
            <Textarea id="nl-address" rows={2} value={form.eventAddress} onChange={(e) => set("eventAddress", e.target.value)} />
          </Field>
          <Field label="Priority" htmlFor="nl-priority">
            <Select id="nl-priority" value={form.priority} onChange={(e) => set("priority", e.target.value)}>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="low">Low</option>
            </Select>
          </Field>
          <Field label="Quoted amount (INR)" htmlFor="nl-quote">
            <Input id="nl-quote" inputMode="decimal" value={form.quotedAmount} onChange={(e) => set("quotedAmount", e.target.value.replace(/[^\d.]/g, ""))} />
          </Field>
          <Field label="First note" htmlFor="nl-note" className="sm:col-span-2">
            <Textarea id="nl-note" rows={3} value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="Anything the salesperson should know" />
          </Field>
        </div>
      </Card>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.back()} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          Create lead
        </Button>
      </div>
    </form>
  );
}
