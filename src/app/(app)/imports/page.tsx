import { Download, FileSpreadsheet, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ImportStatusBadge } from "@/components/imports/status";
import { PageContainer, PageHeader } from "@/components/shell/page";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/card";
import { EmptyState, PermissionDenied } from "@/components/ui/states";
import { getCurrentStaff } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/domain/format";
import { can } from "@/lib/domain/permissions";
import type { ImportBatchRow } from "@/lib/domain/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Imports" };

export default function ImportsPage() {
  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        title="Imports"
        description="Every upload with who imported it, when, and what happened to each row."
        actions={
          <>
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
        <History />
      </Suspense>
    </PageContainer>
  );
}

type Batch = ImportBatchRow & { uploader: { full_name: string } | null; owner: { full_name: string } | null };

async function History() {
  const staff = await getCurrentStaff();
  if (!can(staff.role, "import")) return <PermissionDenied description="Only admins and managers can see imports." />;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("import_batches")
    .select("*, uploader:profiles!import_batches_uploaded_by_fkey(full_name), owner:profiles!import_batches_default_owner_id_fkey(full_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const batches = (data ?? []) as Batch[];

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
    <ul className="flex flex-col gap-2">
      {batches.map((b) => (
        <li key={b.id}>
          <Link href={`/imports/${b.id}`} className="block rounded-2xl border border-line bg-surface px-4 py-3.5 hover:bg-hover/60 sm:px-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate font-medium">
                  <FileSpreadsheet className="size-4 shrink-0 text-fg-muted" />
                  <span className="truncate">{b.file_name}</span>
                </p>
                <p className="mt-0.5 text-[13px] text-fg-muted">
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
  );
}
