"use client";

import { useActionState } from "react";
import { setPassword } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/states";

export default function SetPasswordPage() {
  const [state, action, pending] = useActionState(setPassword, undefined);
  return (
    <>
      <h1 className="text-center text-2xl font-semibold tracking-tight">Set your password</h1>
      <p className="mt-1.5 mb-7 text-center text-sm text-fg-muted">Choose a password you&apos;ll use to sign in.</p>
      <form action={action} className="flex flex-col gap-4" noValidate>
        {state?.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
        <Field label="New password" htmlFor="password" hint="At least 8 characters.">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
        <Field label="Confirm password" htmlFor="confirm">
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </Field>
        <Button type="submit" size="lg" loading={pending} className="mt-2 w-full">
          Save and continue
        </Button>
      </form>
    </>
  );
}
