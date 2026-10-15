import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <>
      <h1 className="text-center text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1.5 mb-7 text-center text-sm text-fg-muted">Sign in to your sales workspace.</p>
      <Suspense fallback={<div className="h-64" />}>
        <LoginForm />
      </Suspense>
    </>
  );
}
