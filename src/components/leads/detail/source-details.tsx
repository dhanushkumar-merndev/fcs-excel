import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/domain/format";
import { platformLabel } from "@/lib/domain/labels";
import type { LeadRow } from "@/lib/domain/types";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 border-b border-line py-2.5 text-sm last:border-0 sm:grid-cols-[180px_1fr]">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children ?? <span className="text-fg-subtle">—</span>}</dd>
    </div>
  );
}

const mono = (v: string | null) => (v ? <span className="font-mono text-[13px] select-all">{v}</span> : null);

export function SourceDetails({ lead, importInfo }: { lead: LeadRow; importInfo: { id: string; file_name: string; created_at: string } | null }) {
  const raw = (lead.source_raw ?? null) as Record<string, string> | null;
  return (
    <div className="flex flex-col gap-5">
      <dl>
        <Row label="Source">{lead.source_system === "meta_lead_ads" ? "Meta lead form (import)" : "Added manually"}</Row>
        <Row label="Platform">{lead.platform ? platformLabel(lead.platform) : null}</Row>
        <Row label="Lead created (original)">{lead.source_created_at ? formatDateTime(lead.source_created_at) : null}</Row>
        <Row label="Added to CRM">{formatDateTime(lead.created_at)}</Row>
        {importInfo ? (
          <Row label="Import">
            <Link className="underline underline-offset-2" href={`/imports/${importInfo.id}`}>
              {importInfo.file_name}
            </Link>
            {lead.import_row_number ? ` · row ${lead.import_row_number}` : ""}
          </Row>
        ) : null}
        <Row label="Original status">{lead.source_status}</Row>
      </dl>

      <details className="group rounded-xl border border-line">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium select-none marker:hidden">
          <span className="flex items-center justify-between">
            Advertising details
            <span className="text-xs font-normal text-fg-subtle group-open:hidden">Show</span>
            <span className="hidden text-xs font-normal text-fg-subtle group-open:inline">Hide</span>
          </span>
        </summary>
        <dl className="px-4 pb-3">
          <Row label="Source lead ID">
            {mono(lead.external_lead_id ?? lead.external_lead_id_raw)}
            {lead.external_id_damaged ? (
              <Badge tint="amber" className="ml-2 h-5 text-[11px]">
                Possibly rounded by Excel
              </Badge>
            ) : null}
          </Row>
          <Row label="Campaign">
            {lead.campaign_name}
            {lead.campaign_id ? <span className="block">{mono(lead.campaign_id)}</span> : null}
          </Row>
          <Row label="Ad set">
            {lead.adset_name}
            {lead.adset_id ? <span className="block">{mono(lead.adset_id)}</span> : null}
          </Row>
          <Row label="Ad">
            {lead.ad_name}
            {lead.ad_id ? <span className="block">{mono(lead.ad_id)}</span> : null}
          </Row>
          <Row label="Form">
            {lead.form_name}
            {lead.form_id ? <span className="block">{mono(lead.form_id)}</span> : null}
          </Row>
          <Row label="Organic">{lead.is_organic === null ? null : lead.is_organic ? "Yes" : "No"}</Row>
          <Row label="Legacy CRM marker">
            {lead.legacy_crm_update ? (
              <>
                {lead.legacy_crm_update}
                <span className="block text-xs text-fg-subtle">
                  From the old spreadsheet. It doesn&apos;t mean this lead was contacted or booked.
                </span>
              </>
            ) : null}
          </Row>
        </dl>
      </details>

      {raw && Object.keys(raw).length ? (
        <details className="group rounded-xl border border-line">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium select-none">Original spreadsheet row</summary>
          <dl className="px-4 pb-3">
            {Object.entries(raw).map(([key, value]) => (
              <Row key={key} label={key}>
                {value === "" || value === null ? null : <span className="font-mono text-[13px]">{String(value)}</span>}
              </Row>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}
