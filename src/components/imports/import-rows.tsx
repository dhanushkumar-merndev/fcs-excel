"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { formatPhone } from "@/lib/domain/format";
import type { DuplicateWarning } from "@/lib/import/duplicates";
import type { Issue, NormalizedLead } from "@/lib/import/normalize";
import { SKIP_REASON_LABELS } from "@/lib/import/prepare";
import { cn } from "@/lib/utils";

export type ImportRowItem = {
  id: string;
  row_number: number;
  status: "pending" | "created" | "skipped" | "invalid" | "failed";
  skip_reason: string | null;
  error_message: string | null;
  issues: Issue[];
  warnings: DuplicateWarning[];
  lead_id: string | null;
  raw: Record<string, string>;
  normalized: NormalizedLead | null;
};

const STATUS_TINT = { created: "green", skipped: "gray", invalid: "red", failed: "red", pending: "blue" } as const;

function rawValue(raw: Record<string, string>, key: string) {
  const hit = Object.entries(raw).find(([k]) => k.trim().toLowerCase() === key);
  return hit?.[1] ?? "";
}

export function ImportRowsTable({
  tab,
  page,
  pageSize,
  total,
  rows,
  counts,
}: {
  batchId: string;
  tab: string;
  page: number;
  pageSize: number;
  total: number;
  rows: ImportRowItem[];
  counts: Record<string, number>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const go = (params: Record<string, string | null>) => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(params)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const tabs: [string, string][] = [
    ["all", "All rows"],
    ["created", "Created"],
    ["skipped", "Skipped"],
    ["invalid", "Invalid"],
    ["failed", "Failed"],
    ["warnings", "Duplicate warnings"],
    ["review", "Needs review"],
  ];

  return (
    <Card>
      <div className="flex gap-1.5 overflow-x-auto border-b border-line px-3 py-2.5">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => go({ tab: key === "all" ? null : key, page: null })}
            className={cn("h-8 shrink-0 rounded-full px-3 text-[13px] font-medium", tab === key ? "bg-fg text-canvas" : "text-fg-muted hover:bg-hover")}
          >
            {label} <span className="tabular opacity-70">{counts[key] ?? 0}</span>
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No rows here" description="Nothing in this category for this import." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-xs text-fg-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-medium">Row</th>
                <th className="px-3 py-2 font-medium">Outcome</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2 font-medium">Details</th>
                <th className="px-3 py-2 font-medium">Lead</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line align-top last:border-0">
                  <td className="tabular px-3 py-2.5 text-fg-muted">{r.row_number}</td>
                  <td className="px-3 py-2.5">
                    <Badge tint={STATUS_TINT[r.status]}>{r.status[0].toUpperCase() + r.status.slice(1)}</Badge>
                  </td>
                  <td className="px-3 py-2.5">{r.normalized?.customer_name || rawValue(r.raw, "full_name") || <span className="text-fg-subtle">—</span>}</td>
                  <td className="px-3 py-2.5">
                    {r.normalized?.phone_e164 ? formatPhone(r.normalized.phone_e164) : null}
                    <span className="block text-[11px] text-fg-subtle">{rawValue(r.raw, "phone")}</span>
                  </td>
                  <td className="max-w-[420px] px-3 py-2.5">
                    <div className="flex flex-col gap-1 text-[12px] leading-snug">
                      {r.status === "failed" ? <p className="text-danger">{r.error_message}</p> : null}
                      {r.skip_reason ? <p className="text-fg-muted">{SKIP_REASON_LABELS[r.skip_reason] ?? r.skip_reason}</p> : null}
                      {r.issues
                        .filter((i) => i.severity !== "info")
                        .map((i, idx) => (
                          <p key={idx} className={i.severity === "error" ? "text-danger" : "text-tint-amber-fg"}>
                            {i.message}
                          </p>
                        ))}
                      {r.warnings.map((w, idx) => (
                        <p key={`w${idx}`} className="text-fg-muted">
                          {w.reason}{" "}
                          {w.lead ? (
                            <Link className="underline underline-offset-2" href={`/leads/${w.lead.id}`}>
                              L-{w.lead.number} {w.lead.name}
                            </Link>
                          ) : w.row ? (
                            `(${w.row.ref ?? `row ${w.row.rowNumber}`})`
                          ) : null}
                        </p>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.lead_id ? (
                      <Link href={`/leads/${r.lead_id}`} className="text-[13px] underline underline-offset-2">
                        {r.status === "skipped" ? "Existing lead" : "Open"}
                      </Link>
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > pageSize ? (
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-sm text-fg-muted">
          <span className="tabular">
            {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => go({ page: String(page - 1) })}>
              Previous
            </Button>
            <Button size="sm" variant="secondary" disabled={page * pageSize >= total} onClick={() => go({ page: String(page + 1) })}>
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
