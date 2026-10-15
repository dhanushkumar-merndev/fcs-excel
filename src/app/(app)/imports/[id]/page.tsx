import { ArrowLeft, Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ImportActions } from "@/components/imports/import-actions";
import { ImportRowsTable, type ImportRowItem } from "@/components/imports/import-rows";
import { ImportStatusBadge } from "@/components/imports/status";
import { Stat } from "@/components/imports/steps/review-step";
import { PageContainer } from "@/components/shell/page";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/card";
import { PermissionDenied } from "@/components/ui/states";
import { getCurrentStaff } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/domain/format";
import { can } from "@/lib/domain/permissions";
import type { ImportBatchRow } from "@/lib/domain/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Import results" };

const TABS = ["all", "created", "skipped", "invalid", "failed", "warnings", "review"] as const;
type Tab = (typeof TABS)[number];
const PAGE_SIZE = 100;

export default function ImportPage(props: PageProps<"/imports/[id]">) {
  return (
    <PageContainer className="max-w-6xl">
      <Suspense fallback={<Skeleton className="h-[480px] w-full rounded-2xl" />}>
        <Content {...props} />
      </Suspense>
    </PageContainer>
  );
}

async function Content({ params, searchParams }: PageProps<"/imports/[id]">) {
  const [staff, { id }, sp] = await Promise.all([getCurrentStaff(), params, searchParams]);
  if (!can(staff.role, "import")) return <PermissionDenied description="Only admins and managers can see imports." />;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const tab: Tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as Tab) : "all";
  const page = Math.max(1, Number(sp.page) || 1);

  const supabase = await createClient();
  const { data: batch } = await supabase
    .from("import_batches")
    .select("*, uploader:profiles!import_batches_uploaded_by_fkey(full_name), owner:profiles!import_batches_default_owner_id_fkey(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!batch) notFound();
  const b = batch as ImportBatchRow & { uploader: { full_name: string } | null; owner: { full_name: string } | null; event_year_choice: { mode: string; year?: number } | null };

  let rowsQuery = supabase
    .from("import_rows")
    .select("id, row_number, status, skip_reason, error_message, issues, warnings, lead_id, raw, normalized", { count: "exact" })
    .eq("batch_id", id)
    .order("row_number")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (tab === "created" || tab === "skipped" || tab === "invalid" || tab === "failed") rowsQuery = rowsQuery.eq("status", tab);
  if (tab === "warnings") rowsQuery = rowsQuery.neq("warnings", "[]");
  if (tab === "review") rowsQuery = rowsQuery.eq("status", "created").neq("normalized->review_flags", "[]");
  const { data: rows, count } = await rowsQuery;

  const reconciled = b.created_count + b.skipped_count + b.invalid_count + b.failed_count + b.pending_count;

  return (
    <>
      <div className="mb-5 flex items-start gap-3">
        <Link href="/imports" className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-hover hover:text-fg" aria-label="Back to imports">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[22px] font-semibold tracking-tight md:text-2xl">{b.file_name}</h1>
            <ImportStatusBadge batch={b} />
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            {b.uploader?.full_name ?? "Someone"} · {formatDateTime(b.created_at)}
            {b.sheet_name ? ` · sheet “${b.sheet_name}”` : ""}
            {b.owner ? ` · assigned to ${b.owner.full_name}` : " · unassigned"}
            {b.event_year_choice?.mode === "fixed" ? ` · year ${b.event_year_choice.year} for dates without a year` : ""}
            {b.event_year_choice?.mode === "after_created" ? " · yearless dates → next date after creation" : ""}
          </p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Created" value={b.created_count} tone="green" />
        <Stat label="Skipped" value={b.skipped_count} />
        <Stat label="Invalid" value={b.invalid_count} tone={b.invalid_count ? "red" : undefined} />
        <Stat label="Failed" value={b.failed_count} tone={b.failed_count ? "red" : undefined} />
        <Stat label="Duplicate warnings" value={b.warning_count} tone={b.warning_count ? "amber" : undefined} />
      </div>
      <p className="tabular mb-4 text-[13px] text-fg-muted">
        {b.created_count} created + {b.skipped_count} skipped + {b.invalid_count} invalid + {b.failed_count} failed
        {b.pending_count ? ` + ${b.pending_count} pending` : ""} = {reconciled} of {b.total_rows} rows. Duplicate warnings overlap these
        outcomes and are counted separately.
      </p>

      <div className="mb-5 flex flex-wrap gap-2">
        <ImportActions batch={b} />
        <Link href={`/leads?import=${b.id}`} className={buttonVariants({ variant: "secondary" })}>
          View imported leads
        </Link>
        <a href={`/api/imports/${b.id}/report?only=problems`} className={buttonVariants({ variant: "secondary" })}>
          <Download /> Error report
        </a>
        <a href={`/api/imports/${b.id}/report`} className={buttonVariants({ variant: "ghost" })}>
          <Download /> All rows
        </a>
      </div>

      <ImportRowsTable
        batchId={b.id}
        tab={tab}
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        rows={(rows ?? []) as unknown as ImportRowItem[]}
        counts={{
          all: b.total_rows,
          created: b.created_count,
          skipped: b.skipped_count,
          invalid: b.invalid_count,
          failed: b.failed_count,
          warnings: b.warning_count,
          review: b.review_count,
        }}
      />
    </>
  );
}
