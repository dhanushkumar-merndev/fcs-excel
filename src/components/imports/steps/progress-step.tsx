"use client";

import { CircleCheck, Download, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Stat } from "./review-step";

export type Counts = { created: number; skipped: number; invalid: number; failed: number; pending: number; total: number; warnings?: number };

/** A finished sheet when several sheets are imported one after another. */
export type SheetResult = { sheet: string; batchId: string; counts: Counts };

export type Progress = {
  phase: "idle" | "uploading" | "processing" | "done" | "error";
  batchId?: string;
  processed?: number;
  total?: number;
  message?: string;
  counts?: Counts;
  /** The sheet being imported (index is 0-based). */
  sheet?: { index: number; count: number; name: string };
  results?: SheetResult[];
};

export function ProgressStep({ progress, onResume }: { progress: Progress; onResume: () => void }) {
  const pct = progress.total ? Math.round(((progress.processed ?? 0) / progress.total) * 100) : 0;
  const c = progress.counts;

  return (
    <Card className="p-5 sm:p-8">
      {progress.phase === "uploading" || progress.phase === "idle" ? (
        <div className="flex flex-col items-center py-6 text-center">
          <Spinner className="mb-3 size-6" />
          <SheetLine progress={progress} />
          <p className="font-medium">Uploading and checking every row on the server…</p>
          <p className="mt-1 text-sm text-fg-muted">This usually takes a few seconds.</p>
        </div>
      ) : null}

      {progress.phase === "processing" ? (
        <div className="py-4">
          <SheetLine progress={progress} />
          <div className="mb-2 flex items-center justify-between text-sm">
            <p className="font-medium">Importing…</p>
            <p className="tabular text-fg-muted">
              {(progress.processed ?? 0).toLocaleString("en-IN")} / {(progress.total ?? 0).toLocaleString("en-IN")} rows
            </p>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-fg transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-3 text-[13px] text-fg-muted">You can leave this page — progress is saved and the import can be resumed from Imports.</p>
        </div>
      ) : null}

      {progress.phase === "error" ? (
        <div className="flex flex-col items-center py-6 text-center">
          <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-tint-red text-tint-red-fg">
            <TriangleAlert className="size-5" />
          </span>
          <p className="font-medium">The import paused</p>
          <p className="mt-1 max-w-md text-sm text-fg-muted">{progress.message}</p>
          {progress.processed !== undefined ? (
            <p className="tabular mt-1 text-sm text-fg-muted">
              {progress.processed.toLocaleString("en-IN")} of {(progress.total ?? 0).toLocaleString("en-IN")} rows done so far.
            </p>
          ) : null}
          <div className="mt-5 flex gap-2">
            <Button onClick={onResume}>{progress.batchId ? "Resume import" : "Try again"}</Button>
            {progress.batchId ? (
              <Link href={`/imports/${progress.batchId}`} className={buttonVariants({ variant: "secondary" })}>
                View import
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {progress.phase === "done" && c && progress.batchId ? (
        <div>
          <div className="mb-6 flex flex-col items-center text-center">
            <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-tint-green text-tint-green-fg">
              <CircleCheck className="size-5" />
            </span>
            <p className="text-lg font-semibold">{(progress.results?.length ?? 0) > 1 ? `${progress.results!.length} sheets imported` : "Import complete"}</p>
            <p className="tabular mt-1 text-sm text-fg-muted">
              {c.created} created + {c.skipped} skipped + {c.invalid} invalid + {c.failed} failed = {c.total} rows
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Created" value={c.created} tone="green" />
            <Stat label="Skipped" value={c.skipped} />
            <Stat label="Invalid" value={c.invalid} tone={c.invalid ? "red" : undefined} />
            <Stat label="Failed" value={c.failed} tone={c.failed ? "red" : undefined} />
          </div>
          {(progress.results?.length ?? 0) > 1 ? (
            <ul className="mt-5 divide-y divide-line overflow-hidden rounded-xl border border-line">
              {progress.results!.map((r) => (
                <li key={r.batchId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.sheet.trim()}</p>
                    <p className="tabular text-[13px] text-fg-muted">
                      {r.counts.created} created · {r.counts.skipped} skipped · {r.counts.invalid} invalid{r.counts.failed ? ` · ${r.counts.failed} failed` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Link href={`/leads?import=${r.batchId}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                      Leads
                    </Link>
                    <Link href={`/imports/${r.batchId}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                      Results
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            {(progress.results?.length ?? 0) > 1 ? (
              <>
                <Link href="/leads?view=new_this_week" className={buttonVariants()}>
                  View new leads
                </Link>
                <Link href="/imports" className={buttonVariants({ variant: "secondary" })}>
                  All imports
                </Link>
              </>
            ) : (
              <>
            <Link href={`/leads?import=${progress.batchId}`} className={buttonVariants()}>
              View imported leads
            </Link>
            <Link href={`/imports/${progress.batchId}`} className={buttonVariants({ variant: "secondary" })}>
              Row-by-row results
            </Link>
            {c.invalid + c.failed + c.skipped > 0 ? (
              <a href={`/api/imports/${progress.batchId}/report?only=problems`} className={buttonVariants({ variant: "secondary" })}>
                <Download /> Error report
              </a>
            ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function SheetLine({ progress }: { progress: Progress }) {
  if (!progress.sheet || progress.sheet.count < 2) return null;
  return (
    <p className="mb-3 text-[13px] text-fg-muted">
      Sheet {progress.sheet.index + 1} of {progress.sheet.count} · <span className="font-medium text-fg">{progress.sheet.name.trim()}</span>
      {progress.results?.length ? ` · ${progress.results.length} done` : ""}
    </p>
  );
}
