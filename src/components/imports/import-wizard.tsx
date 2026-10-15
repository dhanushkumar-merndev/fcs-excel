"use client";

import { ArrowLeft, Check, Download, FileSpreadsheet, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { reportSessionExpired } from "@/components/shell/connection-watch";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/states";
import { Spinner } from "@/components/ui/spinner";
import type { WorkloadRow } from "@/lib/domain/types";
import type { YearChoice } from "@/lib/import/dates";
import type { ExistingLead } from "@/lib/import/duplicates";
import { ImportFileError, parseImportFile, rowLimitError, type ParsedFile, type ParsedSheet } from "@/lib/import/parse";
import { matchKeys, normalizeAll, prepareImport, type Decision } from "@/lib/import/prepare";
import { autoMapHeaders, MAX_IMPORT_ROWS, missingRequired, type ColumnMapping } from "@/lib/import/template";
import { cn } from "@/lib/utils";
import { ConfirmStep } from "./steps/confirm-step";
import { DuplicatesStep } from "./steps/duplicates-step";
import { MappingStep } from "./steps/mapping-step";
import { ProgressStep, type Progress } from "./steps/progress-step";
import { ReviewStep } from "./steps/review-step";

type Step = "upload" | "sheet" | "map" | "review" | "duplicates" | "confirm" | "run";
const STEPS: { key: Step; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "sheet", label: "Sheet" },
  { key: "map", label: "Columns" },
  { key: "review", label: "Clean & validate" },
  { key: "duplicates", label: "Duplicates" },
  { key: "confirm", label: "Confirm" },
  { key: "run", label: "Import" },
];

async function loadXlsx() {
  return import("xlsx");
}

export function ImportWizard({ workload }: { workload: WorkloadRow[] }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [sheetName, setSheetName] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [yearChoice, setYearChoice] = useState<YearChoice>({ mode: "unresolved" });
  const [existing, setExisting] = useState<ExistingLead[] | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [ownerId, setOwnerId] = useState<string>("");
  const [reading, setReading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>({ phase: "idle" });
  const clientToken = useRef<string>(crypto.randomUUID());
  const running = useRef(false);

  const sheet: ParsedSheet | null = useMemo(
    () => parsed?.sheets.find((s) => s.name === sheetName) ?? null,
    [parsed, sheetName],
  );
  const normalized = useMemo(
    () => (sheet && step !== "upload" && step !== "sheet" && step !== "map" ? normalizeAll(sheet.rows, mapping, yearChoice) : null),
    [sheet, mapping, yearChoice, step],
  );
  const plan = useMemo(
    () => (normalized && existing ? prepareImport(normalized, existing, decisions) : null),
    [normalized, existing, decisions],
  );

  // Leaving mid-import is safe (it can be resumed), but warn before closing the tab.
  useEffect(() => {
    if (!(progress.phase === "uploading" || progress.phase === "processing")) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [progress.phase]);

  async function onFile(f: File) {
    setUploadError(null);
    setReading(true);
    try {
      if (f.size > 10 * 1024 * 1024) throw new ImportFileError("This file is larger than 10 MB. Remove extra sheets or columns and try again.");
      const XLSX = await loadXlsx();
      const result = parseImportFile(XLSX, f.name, await f.arrayBuffer());
      const withData = result.sheets.filter((s) => s.rows.length > 0);
      if (!withData.length) throw new ImportFileError("No data rows found. Check that the first row has the column headers and rows below it have values.");
      setFile(f);
      setParsed(result);
      clientToken.current = crypto.randomUUID();
      setExisting(null);
      setDecisions({});
      setYearChoice({ mode: "unresolved" });
      if (withData.length === 1) {
        selectSheet(withData[0]);
      } else {
        setSheetName(null);
        setStep("sheet");
      }
    } catch (error) {
      setUploadError(error instanceof ImportFileError ? error.message : "This file couldn't be read. Save it as .xlsx or .csv and try again.");
    } finally {
      setReading(false);
    }
  }

  function selectSheet(s: ParsedSheet) {
    setSheetName(s.name);
    setMapping(autoMapHeaders(s.headers));
    setStep("map");
  }

  async function loadMatches() {
    if (!normalized) return;
    setMatchError(null);
    setExisting(null);
    const keys = matchKeys(normalized);
    try {
      const res = await fetch("/api/imports/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(keys),
      });
      if (res.status === 401) reportSessionExpired();
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Couldn't check duplicates.");
      setExisting(json.matches as ExistingLead[]);
    } catch (error) {
      setMatchError(error instanceof Error ? error.message : "Couldn't check duplicates. Check your connection and try again.");
    }
  }

  useEffect(() => {
    if (step === "duplicates" && existing === null && !matchError) void loadMatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function runImport() {
    if (!file || !sheet || running.current) return;
    running.current = true;
    setStep("run");
    try {
      let batchId = progress.batchId;
      if (!batchId) {
        setProgress({ phase: "uploading" });
        const form = new FormData();
        form.set("file", file);
        form.set(
          "meta",
          JSON.stringify({
            clientToken: clientToken.current,
            sheetName: sheet.name,
            mapping,
            yearChoice,
            decisions,
            defaultOwnerId: ownerId || null,
          }),
        );
        const res = await fetch("/api/imports", { method: "POST", body: form });
        const json = await res.json().catch(() => ({}));
        if (res.status === 401) reportSessionExpired();
        if (!res.ok) {
          if (json.code === "decisions_required") {
            setProgress({ phase: "idle" });
            setExisting(null);
            setStep("duplicates");
            setMatchError(json.message);
            return;
          }
          throw new Error(json.message ?? "The import couldn't be started.");
        }
        batchId = json.batchId as string;
      }
      setProgress({ phase: "processing", batchId, processed: 0, total: sheet.rows.length });
      for (let attempt = 0; ; ) {
        const res = await fetch(`/api/imports/${batchId}/process`, { method: "POST" });
        const json = await res.json().catch(() => ({}));
        if (res.status === 401) reportSessionExpired();
        if (!res.ok) {
          if (res.status >= 500 && attempt < 3) {
            attempt++;
            await new Promise((r) => setTimeout(r, 1500 * attempt));
            continue;
          }
          throw new Error(json.message ?? "Processing stopped.");
        }
        attempt = 0;
        const done = json.total - json.pending;
        setProgress({ phase: "processing", batchId, processed: done, total: json.total, counts: json });
        if (json.pending === 0) {
          setProgress({ phase: "done", batchId, processed: json.total, total: json.total, counts: json });
          router.refresh();
          break;
        }
      }
    } catch (error) {
      setProgress((p) => ({
        ...p,
        phase: "error",
        message:
          error instanceof TypeError
            ? "Connection lost. Progress so far is saved — resume when you're back online."
            : error instanceof Error
              ? error.message
              : "The import stopped.",
      }));
    } finally {
      running.current = false;
    }
  }

  const visibleSteps = STEPS.filter((s) => s.key !== "sheet" || (parsed?.sheets.filter((x) => x.rows.length > 0).length ?? 0) > 1);
  const stepIndex = visibleSteps.findIndex((s) => s.key === step);
  const missing = missingRequired(mapping);
  const limit = sheet ? rowLimitError(sheet.rows.length) : null;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <Link href="/imports" className="flex size-9 items-center justify-center rounded-full text-fg-muted hover:bg-hover hover:text-fg" aria-label="Back to imports">
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight md:text-2xl">Import leads</h1>
          {file ? (
            <p className="text-sm text-fg-muted">
              {file.name}
              {sheet ? ` · ${sheet.name} · ${sheet.rows.length.toLocaleString("en-IN")} data rows` : ""}
            </p>
          ) : (
            <p className="text-sm text-fg-muted">Excel (.xlsx) or CSV, up to {MAX_IMPORT_ROWS.toLocaleString("en-IN")} rows.</p>
          )}
        </div>
      </div>

      <ol className="mb-6 flex gap-1 overflow-x-auto text-[13px]" aria-label="Import steps">
        {visibleSteps.map((s, i) => (
          <li
            key={s.key}
            aria-current={s.key === step ? "step" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5",
              s.key === step ? "bg-fg text-canvas" : i < stepIndex ? "text-fg" : "text-fg-subtle",
            )}
          >
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
                s.key === step ? "bg-canvas/20" : i < stepIndex ? "bg-tint-green text-tint-green-fg" : "bg-subtle",
              )}
            >
              {i < stepIndex ? <Check className="size-3" /> : i + 1}
            </span>
            {s.label}
          </li>
        ))}
      </ol>

      {step === "upload" ? (
        <UploadStep reading={reading} error={uploadError} onFile={onFile} />
      ) : null}

      {step === "sheet" && parsed ? (
        <Card className="p-5">
          <h2 className="mb-1 text-[15px] font-semibold">Choose a worksheet</h2>
          <p className="mb-4 text-sm text-fg-muted">This workbook has more than one sheet with data.</p>
          <div className="flex flex-col gap-2">
            {parsed.sheets.map((s) => (
              <button
                key={s.name}
                type="button"
                disabled={s.rows.length === 0}
                onClick={() => selectSheet(s)}
                className="flex items-center justify-between rounded-xl border border-line px-4 py-3 text-left hover:bg-hover disabled:opacity-50"
              >
                <span className="flex items-center gap-3">
                  <FileSpreadsheet className="size-4 text-fg-muted" />
                  <span className="font-medium">{s.name}</span>
                </span>
                <span className="tabular text-sm text-fg-muted">{s.rows.length ? `${s.rows.length.toLocaleString("en-IN")} rows` : "Empty"}</span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      {step === "map" && sheet ? (
        <>
          {limit ? (
            <InlineAlert tone="danger" className="mb-4" title="Too many rows">
              {limit}
            </InlineAlert>
          ) : null}
          <MappingStep sheet={sheet} mapping={mapping} onChange={setMapping} />
          <StepNav
            onBack={() => setStep(parsed && parsed.sheets.filter((s) => s.rows.length).length > 1 ? "sheet" : "upload")}
            onNext={() => setStep("review")}
            nextDisabled={missing.length > 0 || Boolean(limit)}
            nextLabel="Clean & validate"
            hint={missing.length ? `Map the required columns: ${missing.join(", ").replace("full_name", "Customer name").replace("phone", "Phone")}` : undefined}
          />
        </>
      ) : null}

      {step === "review" && normalized ? (
        <>
          <ReviewStep rows={normalized} yearChoice={yearChoice} onYearChoice={setYearChoice} />
          <StepNav
            onBack={() => setStep("map")}
            onNext={() => setStep("duplicates")}
            nextDisabled={normalized.every((r) => !r.valid)}
            nextLabel="Check duplicates"
            hint={normalized.every((r) => !r.valid) ? "No valid rows to import. Fix the file and upload it again." : undefined}
          />
        </>
      ) : null}

      {step === "duplicates" ? (
        <>
          {matchError ? (
            <InlineAlert tone="danger" className="mb-4" title="Duplicate check">
              {matchError}{" "}
              <button type="button" className="font-medium underline" onClick={() => void loadMatches()}>
                Try again
              </button>
            </InlineAlert>
          ) : null}
          {!plan ? (
            matchError ? null : (
              <Card className="flex items-center justify-center gap-3 p-10 text-sm text-fg-muted">
                <Spinner /> Checking existing leads for duplicates…
              </Card>
            )
          ) : (
            <DuplicatesStep plan={plan} decisions={decisions} onDecide={(updates) => setDecisions((d) => ({ ...d, ...updates }))} />
          )}
          <StepNav
            onBack={() => setStep("review")}
            onNext={() => setStep("confirm")}
            nextDisabled={!plan || plan.summary.undecided > 0}
            nextLabel="Continue"
            hint={plan && plan.summary.undecided > 0 ? `Decide Keep or Skip for ${plan.summary.undecided} possible duplicate event(s).` : undefined}
          />
        </>
      ) : null}

      {step === "confirm" && plan && file ? (
        <>
          <ConfirmStep plan={plan} fileName={file.name} workload={workload} ownerId={ownerId} onOwner={setOwnerId} yearChoice={yearChoice} />
          <StepNav onBack={() => setStep("duplicates")} onNext={runImport} nextLabel={`Import ${plan.summary.toCreate.toLocaleString("en-IN")} leads`} nextDisabled={plan.summary.toCreate === 0 && plan.summary.skippedExact === 0} />
        </>
      ) : null}

      {step === "run" ? <ProgressStep progress={progress} onResume={runImport} /> : null}
    </div>
  );
}

function StepNav({
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  hint,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="pb-safe sticky bottom-16 z-20 mt-5 flex flex-col gap-2 border-t border-line bg-canvas/95 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between md:bottom-0">
      <p className="text-[13px] text-fg-muted">{hint}</p>
      <div className="flex gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext} disabled={nextDisabled}>
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}

function UploadStep({ reading, error, onFile }: { reading: boolean; error: string | null; onFile: (f: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <InlineAlert tone="danger" title="We couldn't use this file">
          {error}
        </InlineAlert>
      ) : null}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors",
          dragging ? "border-fg bg-subtle" : "border-line-strong hover:bg-subtle",
        )}
      >
        {reading ? (
          <>
            <Spinner className="mb-3 size-6" />
            <p className="font-medium">Reading file…</p>
          </>
        ) : (
          <>
            <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-subtle">
              <Upload className="size-5" />
            </span>
            <p className="font-medium">Drop your Meta leads file here, or tap to choose</p>
            <p className="mt-1 text-sm text-fg-muted">.xlsx or .csv · up to {MAX_IMPORT_ROWS.toLocaleString("en-IN")} data rows · 10 MB</p>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className="sr-only"
          disabled={reading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </label>
      <Card className="p-4 text-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium">Use the standard template</p>
            <p className="text-fg-muted">
              Headers like <code className="font-mono text-[13px]">id</code>, <code className="font-mono text-[13px]">full_name</code>,{" "}
              <code className="font-mono text-[13px]">phone</code> are matched automatically, even with different casing or extra spaces.
            </p>
          </div>
          <a href="/api/imports/template" className={buttonVariants({ variant: "secondary", className: "shrink-0" })}>
            <Download /> Download template
          </a>
        </div>
      </Card>
    </div>
  );
}
