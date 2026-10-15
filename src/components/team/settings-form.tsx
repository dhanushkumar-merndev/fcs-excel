"use client";

import { useState } from "react";
import { updateSettings } from "@/actions/settings";
import { useRunAction } from "@/components/leads/use-run-action";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/states";
import type { BusinessSettings } from "@/lib/domain/types";

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export function SettingsForm({ settings }: { settings: BusinessSettings }) {
  const run = useRunAction();
  const [form, setForm] = useState({
    business_name: settings.business_name,
    reminder_lead_minutes: String(settings.reminder_lead_minutes),
    salesperson_export_enabled: settings.salesperson_export_enabled,
    lost_reasons: settings.lost_reasons.join("\n"),
    unqualified_reasons: settings.unqualified_reasons.join("\n"),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const result = await run(
      () =>
        updateSettings({
          business_name: form.business_name,
          reminder_lead_minutes: Number(form.reminder_lead_minutes),
          salesperson_export_enabled: form.salesperson_export_enabled,
          lost_reasons: lines(form.lost_reasons),
          unqualified_reasons: lines(form.unqualified_reasons),
        }),
      { success: "Settings saved", quietValidation: true },
    );
    setSaving(false);
    if (!result.ok && result.code === "validation") setError(result.message);
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      <Card>
        <CardHeader title="Business" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name" htmlFor="s-name" hint="Shown in the app header.">
            <Input id="s-name" value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} maxLength={80} />
          </Field>
          <div className="grid grid-cols-2 gap-3 text-sm sm:col-span-2 sm:grid-cols-4">
            {[
              ["Timezone", "Asia/Kolkata (IST)"],
              ["Currency", "INR (₹)"],
              ["Date format", "DD MMM YYYY"],
              ["Default phone country", "India (+91)"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-subtle px-3 py-2.5">
                <p className="text-xs text-fg-muted">{label}</p>
                <p className="mt-0.5 font-medium">{value}</p>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Follow-up reminders" description="Reminders are generated on the server every minute and stay until read." />
        <CardBody>
          <Field label="Remind this many minutes before a follow-up is due" htmlFor="s-remind">
            <Input
              id="s-remind"
              type="number"
              inputMode="numeric"
              min={0}
              max={1440}
              value={form.reminder_lead_minutes}
              onChange={(e) => setForm({ ...form, reminder_lead_minutes: e.target.value })}
              className="w-32"
            />
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Closing reasons" description="Choices shown when a lead is marked Lost or Unqualified. One per line." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Lost reasons" htmlFor="s-lost">
            <Textarea id="s-lost" rows={7} value={form.lost_reasons} onChange={(e) => setForm({ ...form, lost_reasons: e.target.value })} />
          </Field>
          <Field label="Unqualified reasons" htmlFor="s-unq">
            <Textarea id="s-unq" rows={7} value={form.unqualified_reasons} onChange={(e) => setForm({ ...form, unqualified_reasons: e.target.value })} />
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Exports" />
        <CardBody>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={form.salesperson_export_enabled}
              onChange={(e) => setForm({ ...form, salesperson_export_enabled: e.target.checked })}
            />
            <span>
              Allow salespeople to export their own leads
              <span className="block text-[13px] text-fg-muted">Off by default. Exports always respect each person&apos;s access.</span>
            </span>
          </label>
        </CardBody>
      </Card>
      <div className="flex justify-end">
        <Button type="submit" loading={saving}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
