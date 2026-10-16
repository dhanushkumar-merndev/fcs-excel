"use client";

import { useState } from "react";
import { changeMyPassword } from "@/actions/auth";
import { useRunAction } from "@/components/leads/use-run-action";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { Sheet } from "@/components/ui/sheet";
import { InlineAlert } from "@/components/ui/states";
import { MIN_PASSWORD } from "@/lib/auth/username";

const EMPTY = { current: "", password: "", confirm: "" };

export function ChangePasswordSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const run = useRunAction();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close(next: boolean) {
    if (saving) return;
    onOpenChange(next);
    if (!next) {
      setForm(EMPTY);
      setError(null);
    }
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    setError(null);
    const result = await run(() => changeMyPassword(form), { success: "Password changed", quietValidation: true });
    setSaving(false);
    if (result.ok) {
      onOpenChange(false);
      setForm(EMPTY);
    } else if (result.code === "validation") {
      setError(result.message);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={close}
      size="sm"
      title="Change password"
      description="You'll use the new password the next time you sign in."
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            Save password
          </Button>
        </>
      }
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        <Field label="Current password" htmlFor="pw-current">
          <PasswordInput id="pw-current" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
        </Field>
        <Field label="New password" htmlFor="pw-new" hint={`At least ${MIN_PASSWORD} characters.`}>
          <PasswordInput id="pw-new" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-confirm">
          <PasswordInput id="pw-confirm" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </Field>
        {/* Lets Enter submit from any field. */}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
