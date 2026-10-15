"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";
import { reportSessionExpired } from "@/components/shell/connection-watch";
import type { ActionResult } from "@/lib/action-result";

/**
 * Runs a server action with consistent feedback: success toast, session-expiry prompt,
 * conflict reload, and network failures that never discard what the user typed.
 */
export function useRunAction() {
  const router = useRouter();
  return useCallback(
    async <T,>(fn: () => Promise<ActionResult<T>>, opts: { success?: string; quietValidation?: boolean } = {}) => {
      let result: ActionResult<T>;
      try {
        result = await fn();
      } catch {
        result = {
          ok: false,
          code: "network",
          message: "Connection problem. Nothing was saved — your input is still here, try again.",
        };
      }
      if (result.ok) {
        if (opts.success) toast.success(opts.success);
        return result;
      }
      if (result.code === "unauthenticated") {
        reportSessionExpired();
      } else if (result.code === "conflict") {
        toast.error(result.message, {
          duration: 10_000,
          action: { label: "Reload", onClick: () => router.refresh() },
        });
      } else if (!(opts.quietValidation && (result.code === "validation" || result.code === "pending_follow_ups"))) {
        toast.error(result.message);
      }
      return result;
    },
    [router],
  );
}
