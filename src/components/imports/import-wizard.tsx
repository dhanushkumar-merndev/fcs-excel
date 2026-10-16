"use client";

import { ArrowLeft, Check, Download, FileSpreadsheet, TriangleAlert, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { reportSessionExpired } from "@/components/shell/connection-watch";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/states";
import { Spinner } from "@/components/ui/spinner";
import type { WorkloadRow } from "@/lib/domain/types";
import type { YearChoice } from "@/lib/import/dates";
import type { ExistingLead } from "@/lib/import/duplicates";
import { ImportFileError, parseImportFile, rowLimitError, type ParsedFile, type ParsedSheet } from "@/lib/import/parse";
import { decisionsForSheet, matchKeys, normalizeSheets, prepareImport, summarizeBySheet, type Decision } from "@/lib/import/prepare";
import { autoMapHeaders, MAX_IMPORT_ROWS, missingRequired, type ColumnMapping } from "@/lib/import/template";
import { cn } from "@/lib/utils";
import { ConfirmStep } from "./steps/confirm-step";
import { DuplicatesStep } from "./steps/duplicates-step";
import { MappingStep } from "./steps/mapping-step";
import { ProgressStep, type Counts, type Progress, type SheetResult } from "./steps/progress-step";
import { ReviewStep } from "./steps/review-step";

type Step = "upload" | "sheet" | "map" | "review" | "duplicates" | "confirm" | "run";
const STEPS: { key: Step; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "sheet", label: "Sheets" },
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
  const [selected, setSelected] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, ColumnMapping>>({});
  const [mapSheet, setMapSheet] = useState<string | null>(null);
  const [yearChoice, setYearChoice] = useState<YearChoice>({ mode: "unresolved" });
  const [existing, setExisting] = useState<ExistingLead[] | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [ownerId, setOwnerId] = useState<string>("");
  const [reading, setReading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>({ phase: "idle" });
  // One idempotency token per sheet, so a retried or resumed import never creates a second batch.
  const clientTokens = useRef<Record<string, string>>({});
  const running = useRef(false);

  const sheetsWithData = useMemo(() => parsed?.sheets.filter((s) => s.rows.length > 0) ?? [], [parsed]);
  const chosen: ParsedSheet[] = useMemo(() => parsed?.sheets.filter((s) => selected.includes(s.name)) ?? [], [parsed, selected]);
  const multi = chosen.length > 1;
  const normalized = useMemo(
    () =>
      chosen.length && step !== "upload" && step !== "sheet" && step !== "map"
        ? normalizeSheets(
            chosen.map((s) => ({ name: s.name, rows: s.rows, mapping: mappings[s.name] ?? {} })),
            yearChoice,
          )
        : null,
    [chosen, mappings, yearChoice, step],
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
      clientTokens.current = {};
      setMappings({});
      setProgress({ phase: "idle" });
      setYearChoice({ mode: "unresolved" });
      if (withData.length === 1) {
        chooseSheets(result, [withData[0].name]);
      } else {
        setSelected(withData.filter((s) => !rowLimitError(s.rows.length)).map((s) => s.name));
        setStep("sheet");
      }
    } catch (error) {
      setUploadError(error instanceof ImportFileError ? error.message : "This file couldn't be read. Save it as .xlsx or .csv and try again.");
    } finally {
      setReading(false);
    }
  }

  function chooseSheets(source: ParsedFile, names: string[]) {
    setSelected(names);
    setMappings((prev) => {
      const next = { ...prev };
      for (const s of source.sheets) if (names.includes(s.name) && !next[s.name]) next[s.name] = autoMapHeaders(s.headers, s.rows);
      return next;
    });
    setMapSheet(names[0] ?? null);
    setExisting(null);
    setDecisions({});
    setStep("map");
  }

  function toggleSheet(name: string) {
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
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

  /**
   * Imports each chosen sheet as its own batch, in workbook order. Sheets run one after another so
   * a lead repeated in a later sheet is caught by the database as already imported. Safe to call
   * again after an interruption: finished sheets are skipped and the current one resumes.
   */
  async function runImport() {
    if (!file || !chosen.length || running.current) return;
    running.current = true;
    setStep("run");
    const results: SheetResult[] = [...(progress.results ?? [])];
    let current: { batchId?: string; sheet?: Progress["sheet"] } = {};
    try {
      for (const [index, sheet] of chosen.entries()) {
        if (results.some((r) => r.sheet === sheet.name)) continue;
        const sheetInfo = { index, count: chosen.length, name: sheet.name };
        current = { sheet: sheetInfo };
        const token = (clientTokens.current[sheet.name] ??= crypto.randomUUID());
        setProgress({ phase: "uploading", sheet: sheetInfo, results });
        const form = new FormData();
        form.set("file", file);
        form.set(
          "meta",
          JSON.stringify({
            clientToken: token,
            sheetName: sheet.name,
            mapping: mappings[sheet.name] ?? {},
            yearChoice,
            decisions: decisionsForSheet(decisions, index, chosen.length),
            defaultOwnerId: ownerId || null,
          }),
        );
        const res = await fetch("/api/imports", { method: "POST", body: form });
        const json = await res.json().catch(() => ({}));
        if (res.status === 401) reportSessionExpired();
        if (!res.ok) {
          if (json.code === "decisions_required") {
            setProgress({ phase: "idle", results });
            setExisting(null);
            setStep("duplicates");
            setMatchError(multi ? `${sheet.name.trim()}: ${json.message}` : json.message);
            return;
          }
          throw new Error(multi ? `${sheet.name.trim()}: ${json.message ?? "The import couldn't be started."}` : (json.message ?? "The import couldn't be started."));
        }
        const batchId = json.batchId as string;
        current = { batchId, sheet: sheetInfo };
        setProgress({ phase: "processing", batchId, sheet: sheetInfo, results, processed: 0, total: sheet.rows.length });
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
          setProgress({ phase: "processing", batchId, sheet: sheetInfo, results, processed: json.total - json.pending, total: json.total, counts: json });
          if (json.pending === 0) {
            results.push({ sheet: sheet.name, batchId, counts: json });
            break;
          }
        }
      }
      const counts = sumCounts(results.map((r) => r.counts));
      setProgress({ phase: "done", batchId: results.at(-1)?.batchId, results, processed: counts.total, total: counts.total, counts });
      router.refresh();
    } catch (error) {
      setProgress((p) => ({
        ...p,
        ...current,
        results,
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

  const visibleSteps = STEPS.filter((s) => s.key !== "sheet" || sheetsWithData.length > 1);
  const stepIndex = visibleSteps.findIndex((s) => s.key === step);
  const mapTarget = chosen.find((s) => s.name === mapSheet) ?? chosen[0] ?? null;
  const sheetsMissing = chosen.filter((s) => missingRequired(mappings[s.name] ?? {}).length > 0);
  const limit = chosen.length === 1 ? rowLimitError(chosen[0].rows.length) : null;
  const chosenRows = chosen.reduce((n, s) => n + s.rows.length, 0);
  const selectable = sheetsWithData.filter((s) => !rowLimitError(s.rows.length));
  const selectedRows = (parsed?.sheets ?? []).filter((s) => selected.includes(s.name)).reduce((n, s) => n + s.rows.length, 0);

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <Link href="/imports" className="flex size-9 items-center justify-center rounded-full text-fg-muted hover:bg-hover hover:text-fg" aria-label="Back to imports">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight md:text-2xl">Import leads</h1>
          {file ? (
            <p className="truncate text-sm text-fg-muted">
              {file.name}
              {step !== "sheet" && chosen.length === 1 ? ` · ${chosen[0].name.trim()} · ${chosen[0].rows.length.toLocaleString("en-IN")} data rows` : ""}
              {step !== "sheet" && multi ? ` · ${chosen.length} sheets · ${chosenRows.toLocaleString("en-IN")} data rows` : ""}
            </p>
          ) : (
            <p className="text-sm text-fg-muted">Excel (.xlsx) or CSV, up to {MAX_IMPORT_ROWS.toLocaleString("en-IN")} rows per sheet.</p>
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
        <>
          <Card className="p-4 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold">Choose worksheets</h2>
                <p className="mt-0.5 text-sm text-fg-muted">
                  Tick every sheet to import. Each sheet gets its own column matching, and a lead that appears in more than one sheet is imported once.
                </p>
              </div>
              {selectable.length > 1 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setSelected(selected.length === selectable.length ? [] : selectable.map((s) => s.name))}
                >
                  {selected.length === selectable.length ? "Clear all" : "Select all"}
                </Button>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              {parsed.sheets.map((s) => {
                const tooMany = Boolean(rowLimitError(s.rows.length));
                const disabled = s.rows.length === 0 || tooMany;
                const checked = selected.includes(s.name);
                return (
                  <label
                    key={s.name}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-xl border px-4 py-3 transition-colors",
                      disabled ? "cursor-not-allowed border-line opacity-50" : "cursor-pointer hover:bg-hover",
                      checked ? "border-fg-subtle bg-subtle" : "border-line",
                    )}
                  >
                    <Checkbox checked={checked} disabled={disabled} onChange={() => toggleSheet(s.name)} />
                    <FileSpreadsheet className="size-4 shrink-0 text-fg-muted" />
                    <span className="min-w-0 flex-1 truncate font-medium">{s.name.trim()}</span>
                    <span className={cn("tabular shrink-0 text-sm", tooMany ? "text-danger" : "text-fg-muted")}>
                      {s.rows.length === 0
                        ? "Empty"
                        : tooMany
                          ? `${s.rows.length.toLocaleString("en-IN")} rows · over ${MAX_IMPORT_ROWS.toLocaleString("en-IN")}`
                          : `${s.rows.length.toLocaleString("en-IN")} rows`}
                    </span>
                  </label>
                );
              })}
            </div>
            {sheetsWithData.some((s) => rowLimitError(s.rows.length)) ? (
              <p className="mt-3 text-[13px] text-fg-muted">
                Sheets over {MAX_IMPORT_ROWS.toLocaleString("en-IN")} rows can&apos;t be imported in one go — split them into smaller sheets first.
              </p>
            ) : null}
          </Card>
          <StepNav
            onBack={() => setStep("upload")}
            onNext={() => chooseSheets(parsed, parsed.sheets.filter((s) => selected.includes(s.name)).map((s) => s.name))}
            nextDisabled={selected.length === 0}
            nextLabel={selected.length > 1 ? `Continue with ${selected.length} sheets` : "Continue"}
            hint={selected.length ? `${selected.length} ${selected.length === 1 ? "sheet" : "sheets"} · ${selectedRows.toLocaleString("en-IN")} rows selected` : "Tick at least one sheet."}
          />
        </>
      ) : null}

      {step === "map" && mapTarget ? (
        <>
          {limit ? (
            <InlineAlert tone="danger" className="mb-4" title="Too many rows">
              {limit}
            </InlineAlert>
          ) : null}
          {multi ? (
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Sheets">
              {chosen.map((s) => {
                const missing = missingRequired(mappings[s.name] ?? {}).length > 0;
                const active = s.name === mapTarget.name;
                return (
                  <button
                    key={s.name}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setMapSheet(s.name)}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors",
                      active ? "border-fg bg-fg text-canvas" : "border-line hover:bg-hover",
                    )}
                  >
                    {missing ? <TriangleAlert className="size-3.5 text-danger" aria-label="Needs mapping" /> : <Check className="size-3.5" aria-label="Ready" />}
                    {s.name.trim()}
                    <span className="tabular opacity-70">{s.rows.length.toLocaleString("en-IN")}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <MappingStep
            key={mapTarget.name}
            sheet={mapTarget}
            title={multi ? mapTarget.name.trim() : undefined}
            mapping={mappings[mapTarget.name] ?? {}}
            onChange={(m) => setMappings((prev) => ({ ...prev, [mapTarget.name]: m }))}
          />
          <StepNav
            onBack={() => setStep(sheetsWithData.length > 1 ? "sheet" : "upload")}
            onNext={() => setStep("review")}
            nextDisabled={sheetsMissing.length > 0 || Boolean(limit)}
            nextLabel="Clean & validate"
            hint={
              sheetsMissing.length
                ? multi
                  ? `Map Customer name and Phone for: ${sheetsMissing.map((s) => s.name.trim()).join(", ")}`
                  : `Map the required columns: ${missingRequired(mappings[mapTarget.name] ?? {}).join(", ").replace("full_name", "Customer name").replace("phone", "Phone")}`
                : multi
                  ? "Each sheet was matched on its own — check any sheet by tapping it above."
                  : undefined
            }
          />
        </>
      ) : null}

      {step === "review" && normalized ? (
        <>
          <ReviewStep rows={normalized} yearChoice={yearChoice} onYearChoice={setYearChoice} />
          <StepNav
            onBack={() => setStep("map")}
            onNext={() => {
              setExisting(null);
              setMatchError(null);
              setStep("duplicates");
            }}
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
          <ConfirmStep
            plan={plan}
            fileName={file.name}
            sheets={multi ? summarizeBySheet(plan) : undefined}
            workload={workload}
            ownerId={ownerId}
            onOwner={setOwnerId}
            yearChoice={yearChoice}
          />
          <StepNav
            onBack={() => setStep("duplicates")}
            onNext={runImport}
            nextLabel={`Import ${plan.summary.toCreate.toLocaleString("en-IN")} leads${multi ? ` from ${chosen.length} sheets` : ""}`}
            nextDisabled={plan.summary.toCreate === 0 && plan.summary.skippedExact === 0}
          />
        </>
      ) : null}

      {step === "run" ? <ProgressStep progress={progress} onResume={runImport} /> : null}
    </div>
  );
}

function sumCounts(list: Counts[]): Counts {
  return list.reduce<Counts>(
    (sum, c) => ({
      created: sum.created + c.created,
      skipped: sum.skipped + c.skipped,
      invalid: sum.invalid + c.invalid,
      failed: sum.failed + c.failed,
      pending: sum.pending + c.pending,
      total: sum.total + c.total,
    }),
    { created: 0, skipped: 0, invalid: 0, failed: 0, pending: 0, total: 0 },
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
            <p className="mt-1 text-sm text-fg-muted">.xlsx or .csv · up to {MAX_IMPORT_ROWS.toLocaleString("en-IN")} data rows per sheet · 10 MB</p>
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
