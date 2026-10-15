"use client";

import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getBrowserClient } from "@/lib/supabase/browser";

export const SESSION_EXPIRED_EVENT = "crm:session-expired";

/** Tells the shell that a server action reported an expired session. */
export function reportSessionExpired() {
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

/** Offline banner + session-expiry prompt. Drafts stay on the device, so re-signing in loses nothing. */
export function ConnectionWatch() {
  const [offline, setOffline] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const onExpired = () => setExpired(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    const { data } = getBrowserClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setExpired(true);
    });
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <>
      {offline ? (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-tint-amber px-4 py-2 text-[13px] font-medium text-tint-amber-fg"
        >
          <WifiOff className="size-4" /> You&apos;re offline. Changes will fail until you reconnect — nothing typed is lost.
        </div>
      ) : null}
      {expired ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-overlay p-4 sm:items-center" role="alertdialog" aria-modal="true" aria-labelledby="session-expired-title">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-soft">
            <h2 id="session-expired-title" className="text-[17px] font-semibold">
              Session expired
            </h2>
            <p className="mt-1.5 text-sm text-fg-muted">
              Sign in again to continue. Notes you were typing are saved on this device and will be here when you return.
            </p>
            <Button
              className="mt-5 w-full"
              onClick={() => {
                // Full page load on purpose: clears all client state kept across routes.
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                window.location.href = `/login?reason=expired&next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
              }}
            >
              Sign in again
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
