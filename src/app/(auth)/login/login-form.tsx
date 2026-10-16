"use client";

import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { signIn } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { InlineAlert } from "@/components/ui/states";

const REASONS: Record<string, { tone: "info" | "warning"; text: string }> = {
  inactive: { tone: "warning", text: "Your account is not active. Contact your admin if this is unexpected." },
  expired: { tone: "info", text: "Your session expired. Sign in again to continue — unsaved notes are kept on this device." },
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
      <Field label="Username" htmlFor="username">
        <Input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          defaultValue={state?.username}
          aria-invalid={Boolean(state?.error) || undefined}
        />
      </Field>
      <Field label="Password" htmlFor="password">
        <PasswordInput id="password" name="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" size="lg" loading={pending} className="mt-2 w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-[13px] text-fg-subtle">Forgot your password? Ask your admin to reset it.</p>
    </form>
  );
}
