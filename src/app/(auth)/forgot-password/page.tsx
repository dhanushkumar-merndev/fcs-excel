"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/states";

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);
  return (
    <>
      <h1 className="text-center text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1.5 mb-7 text-center text-sm text-fg-muted">We&apos;ll email you a link to set a new password.</p>
      <form action={action} className="flex flex-col gap-4" noValidate>
        {state?.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
        {state?.success ? <InlineAlert tone="success">{state.success}</InlineAlert> : null}
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" required />
        </Field>
        <Button type="submit" size="lg" loading={pending} className="mt-2 w-full">
          Send reset link
        </Button>
        <Link href="/login" className="self-center text-sm text-fg-muted hover:text-fg hover:underline">
          Back to sign in
        </Link>
      </form>
    </>
  );
}
