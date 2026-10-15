"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { signIn } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/states";

const REASONS: Record<string, { tone: "info" | "warning"; text: string }> = {
  inactive: { tone: "warning", text: "Your account is not active. Contact your admin if this is unexpected." },
  expired: { tone: "info", text: "Your session expired. Sign in again to continue — unsaved notes are kept on this device." },
  link_expired: { tone: "warning", text: "That link has expired or was already used. Ask your admin for a new one." },
  signed_out: { tone: "info", text: "You've been signed out." },
};

export function LoginForm() {
  const params = useSearchParams();
  const [state, action, pending] = useActionState(signIn, undefined);
  const reason = REASONS[params.get("reason") ?? ""];

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={params.get("next") ?? "/"} />
      {reason && !state?.error ? <InlineAlert tone={reason.tone}>{reason.text}</InlineAlert> : null}
      {state?.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          required
          defaultValue={state?.email}
          aria-invalid={Boolean(state?.error) || undefined}
        />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" size="lg" loading={pending} className="mt-2 w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <Link href="/forgot-password" className="self-center text-sm text-fg-muted hover:text-fg hover:underline">
        Forgot password?
      </Link>
    </form>
  );
}
