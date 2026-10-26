import { Download, FileSpreadsheet, Sheet, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ImportStatusBadge } from "@/components/imports/status";
import { PageContainer, PageHeader } from "@/components/shell/page";
import { SyncNowButton } from "@/components/shell/sheet-sync-status";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/card";
import { EmptyState, PermissionDenied } from "@/components/ui/states";
import { getCurrentStaff } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/domain/format";
import { importName } from "@/lib/domain/labels";
import { can } from "@/lib/domain/permissions";
import { SHEET_SYNC_COLUMNS, type SheetSyncStatus } from "@/lib/domain/sheet-sync";
import type { ImportBatchRow } from "@/lib/domain/types";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Imports" };

const PAGE_SIZE = 25;
const SOURCES = [
  ["all", "All"],
  ["upload", "Uploads"],
  ["sheet_sync", "Google Sheet sync"],
] as const;
type Source = (typeof SOURCES)[number][0];

export default function ImportsPage({ searchParams }: PageProps<"/imports">) {
  return (
    <PageContainer>
      <PageHeader
        title="Imports"
        description="Every upload with who imported it, when, and what happened to each row."
        actions={
          <>
            <Suspense fallback={null}>
              <SheetSyncActions />
            </Suspense>
            <a href="/api/imports/template" className={buttonVariants({ variant: "secondary" })}>
              <Download /> Template
            </a>
            <Link href="/imports/new" className={buttonVariants()}>
              <Upload /> New import
            </Link>
          </>
        }
      />
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-2xl" />}>
        <History searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

/** Google Sheet sync settings, and "Sync sheet now" once it is set up and on. */
async function SheetSyncActions() {
  const staff = await getCurrentStaff();
  if (!can(staff.role, "import")) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("sheet_sync").select(SHEET_SYNC_COLUMNS).eq("id", 1).maybeSingle();
  const status = data as SheetSyncStatus | null;
  return (
    <>
      {status?.enabled ? <SyncNowButton /> : null}
      <Link href="/imports/sheet-sync" className={buttonVariants({ variant: "secondary" })}>
        <Sheet /> Google Sheet sync
      </Link>
    </>
  );
}

type Batch = ImportBatchRow & { uploader: { full_name: string } | null; owner: { full_name: string } | null };

async function History({ searchParams }: { searchParams: PageProps<"/imports">["searchParams"] }) {
  const [staff, sp] = await Promise.all([getCurrentStaff(), searchParams]);
  if (!can(staff.role, "import")) return <PermissionDenied description="Only admins and managers can see imports." />;
  const source: Source = SOURCES.some(([key]) => key === sp.source) ? (sp.source as Source) : "all";
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const supabase = await createClient();
  let query = supabase
    .from("import_batches")
    .select("*, uploader:profiles!import_batches_uploaded_by_fkey(full_name), owner:profiles!import_batches_default_owner_id_fkey(full_name)", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (source !== "all") query = query.eq("origin", source);
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  const batches = (data ?? []) as Batch[];
  const total = count ?? batches.length;
  const href = (params: { source?: Source; page?: number }) => {
    const next = new URLSearchParams();
    const s = params.source ?? source;
    const p = params.page ?? 1;
    if (s !== "all") next.set("source", s);
    if (p > 1) next.set("page", String(p));
    const qs = next.toString();
    return qs ? `/imports?${qs}` : "/imports";
  };

  const filters = (
    <nav className="mb-3 flex gap-1.5 overflow-x-auto" aria-label="Filter imports">
      {SOURCES.map(([key, label]) => (
        <Link
          key={key}
          href={href({ source: key })}
          aria-current={key === source ? "page" : undefined}
          className={cn(
            "flex h-8 shrink-0 items-center rounded-full px-3 text-[13px] font-medium",
            key === source ? "bg-fg text-canvas" : "text-fg-muted hover:bg-hover",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );

  if (!batches.length && (source !== "all" || page > 1)) {
    return (
      <>
        {filters}
        <div className="rounded-2xl border border-line">
          <EmptyState
            icon={<FileSpreadsheet />}
            title={page > 1 ? "No more imports" : "Nothing here yet"}
            description={
              source === "sheet_sync" ? "Google Sheet sync adds an entry here whenever it finds new rows." : "Uploads you make appear here."
            }
            action={
              <Link href={href({ page: 1 })} className={buttonVariants({ variant: "secondary" })}>
                Back to the first page
              </Link>
            }
          />
        </div>
      </>
    );
  }

  if (!batches.length) {
    return (
      <div className="rounded-2xl border border-line">
        <EmptyState
          icon={<FileSpreadsheet />}
          title="No imports yet"
          description="Upload a Meta leads export (.xlsx or .csv) to create leads in bulk."
          action={
            <Link href="/imports/new" className={buttonVariants()}>
              <Upload /> Import leads
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <>
      {filters}
      <ul className="flex flex-col gap-2">
        {batches.map((b) => (
          <li key={b.id}>
            <Link href={`/imports/${b.id}`} className="block rounded-2xl border border-line bg-surface px-4 py-3.5 hover:bg-hover/60 sm:px-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate font-medium">
                    <FileSpreadsheet className="size-4 shrink-0 text-fg-muted" />
                    <span className="truncate">{importName(b.file_name, b.sheet_name).title}</span>
                  </p>
                  <p className="mt-0.5 text-[13px] text-fg-muted">
                    {importName(b.file_name, b.sheet_name).file ? `${importName(b.file_name, b.sheet_name).file} · ` : ""}
                    {b.uploader?.full_name ?? "Someone"} · {formatDateTime(b.created_at)}
                    {b.owner ? ` · assigned to ${b.owner.full_name}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                  <span className="tabular text-fg-muted">
                    <span className="font-medium text-fg">{b.created_count}</span> created · {b.skipped_count} skipped · {b.invalid_count} invalid
                    {b.failed_count ? <span className="text-danger"> · {b.failed_count} failed</span> : null}
                    {b.review_count ? ` · ${b.review_count} to review` : ""}
                  </span>
                  <ImportStatusBadge batch={b} />
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {total > PAGE_SIZE ? (
        <div className="mt-3 flex items-center justify-between gap-3 text-[13px] text-fg-muted">
          <span className="tabular">
            {((page - 1) * PAGE_SIZE + 1).toLocaleString("en-IN")}–{Math.min(total, page * PAGE_SIZE).toLocaleString("en-IN")} of{" "}
            {total.toLocaleString("en-IN")}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={href({ page: page - 1 })} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                Previous
              </Link>
            ) : (
              <span
                className={buttonVariants({
                  variant: "secondary",
                  size: "sm",
                  className: "pointer-events-none opacity-50",
                })}
              >
                Previous
              </span>
            )}
            {page * PAGE_SIZE < total ? (
              <Link href={href({ page: page + 1 })} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                Next
              </Link>
            ) : (
              <span
                className={buttonVariants({
                  variant: "secondary",
                  size: "sm",
                  className: "pointer-events-none opacity-50",
                })}
              >
                Next
              </span>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
