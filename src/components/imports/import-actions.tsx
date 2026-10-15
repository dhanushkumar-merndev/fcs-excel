"use client";

import { Play, RefreshCw, Trash } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { reportSessionExpired } from "@/components/shell/connection-watch";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import type { ImportBatchRow } from "@/lib/domain/types";
import { isInterrupted } from "./status";

async function post(url: string) {
  const res = await fetch(url, { method: "POST" });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) reportSessionExpired();
  if (!res.ok) throw new Error(json.message ?? "Request failed.");
  return json;
}

/** Resume pending rows, retry failed rows, or discard an import that created nothing. All are idempotent. */
export function ImportActions({ batch }: { batch: ImportBatchRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "resume" | "retry" | "discard">(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const canResume = batch.pending_count > 0 && batch.status !== "cancelled" && (isInterrupted(batch) || batch.status === "ready");
  const canDiscard = batch.created_count === 0 && batch.status !== "cancelled" && batch.status !== "completed" && batch.status !== "completed_with_issues";

  async function processAll() {
    for (;;) {
      const json = await post(`/api/imports/${batch.id}/process`);
      setProgress(`${json.total - json.pending} / ${json.total}`);
      if (json.pending === 0) return json;
    }
  }

  async function resume() {
    setBusy("resume");
    try {
      const json = await processAll();
      toast.success("Import finished", { description: `${json.created} created · ${json.skipped} skipped · ${json.failed} failed` });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Resume failed. Try again.");
    } finally {
      setBusy(null);
      setProgress(null);
      router.refresh();
    }
  }

  async function retry() {
    setBusy("retry");
    try {
      await post(`/api/imports/${batch.id}/retry`);
      const json = await processAll();
      toast.success("Retried failed rows", { description: `${json.failed} still failing` });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Retry failed.");
    } finally {
      setBusy(null);
      setProgress(null);
      router.refresh();
    }
  }

  async function discard() {
    setBusy("discard");
    try {
      await post(`/api/imports/${batch.id}/cancel`);
      toast.success("Import discarded");
      setConfirmDiscard(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't discard.");
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  return (
    <>
      {canResume ? (
        <Button onClick={resume} loading={busy === "resume"} disabled={busy !== null}>
          <Play /> {busy === "resume" && progress ? `Importing ${progress}` : `Resume (${batch.pending_count} rows left)`}
        </Button>
      ) : null}
      {batch.failed_count > 0 ? (
        <Button variant="secondary" onClick={retry} loading={busy === "retry"} disabled={busy !== null}>
          <RefreshCw /> {busy === "retry" && progress ? `Retrying ${progress}` : `Retry ${batch.failed_count} failed`}
        </Button>
      ) : null}
      {canDiscard ? (
        <Button variant="ghost" onClick={() => setConfirmDiscard(true)} disabled={busy !== null}>
          <Trash /> Discard
        </Button>
      ) : null}
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard this import?"
        description="No leads were created from it. Its row results stay in the history."
        confirmLabel="Discard import"
        loading={busy === "discard"}
        onConfirm={discard}
      />
    </>
  );
}
