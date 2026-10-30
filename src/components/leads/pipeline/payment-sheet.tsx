"use client";

import { useState } from "react";
import { recordPayment } from "@/actions/pipeline";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { InlineAlert } from "@/components/ui/states";
import { formatINR, todayIST } from "@/lib/domain/format";
import { PAYMENT_KINDS, PAYMENT_MODES } from "@/lib/domain/labels";
import { useOnOpen, useRequestId } from "@/lib/hooks";
import { useRunAction } from "../use-run-action";

type Kind = (typeof PAYMENT_KINDS)[number]["value"];

/** Adds one entry to the payment ledger. Entries can't be edited; a mistake is fixed with a refund entry. */
export function PaymentSheet({
  lead,
  defaultKind,
  paidTotal,
  open,
  onOpenChange,
}: {
  lead: { id: string; customer_name: string };
  defaultKind: Kind;
  paidTotal: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const run = useRunAction();
  const [requestId, rotate] = useRequestId();
  const [kind, setKind] = useState<Kind>(defaultKind);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayIST());
  const [mode, setMode] = useState("upi");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useOnOpen(open, () => {
    setKind(defaultKind);
    setAmount("");
    setPaidOn(todayIST());
    setMode("upi");
    setReference("");
    setNote("");
    setError(null);
  });

  async function save() {
    if (!(Number(amount) > 0)) return setError("Enter an amount above zero.");
    setSaving(true);
    setError(null);
    const result = await run(
      () => recordPayment({ requestId, leadId: lead.id, kind, amount, paidOn, mode: mode as never, reference, note }),
      { quietValidation: true, success: `${PAYMENT_KINDS.find((k) => k.value === kind)?.label} of ${formatINR(Number(amount))} recorded` },
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
      title="Record payment"
      description={`${lead.customer_name} · paid so far ${formatINR(paidTotal)}`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {error ? <InlineAlert tone="danger" className="sm:col-span-2">{error}</InlineAlert> : null}
        <Field label="Type" htmlFor="pay-kind">
          <Select id="pay-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {PAYMENT_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amount (INR)" htmlFor="pay-amount" required>
          <Input
            id="pay-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="e.g. 1000"
            autoFocus
          />
        </Field>
        <Field label="Received on" htmlFor="pay-date" required>
          <Input id="pay-date" type="date" value={paidOn} max={todayIST()} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        <Field label="Mode" htmlFor="pay-mode">
          <Select id="pay-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            {PAYMENT_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference" htmlFor="pay-ref" hint="UPI or bank transaction ID" className="sm:col-span-2">
          <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Note" htmlFor="pay-note" className="sm:col-span-2">
          <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        <p className="text-[13px] text-fg-subtle sm:col-span-2">Payments can&apos;t be edited. To fix a mistake, record a refund.</p>
      </div>
    </Sheet>
  );
}
