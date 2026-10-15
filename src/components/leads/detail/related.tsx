import Link from "next/link";
import { formatCalendarDate, formatDate } from "@/lib/domain/format";
import { humanizeCode } from "@/lib/domain/labels";
import type { LeadDetail } from "@/lib/leads/queries";
import { StageBadge } from "../badges";

/** Other enquiries with the same phone that the current user is allowed to see (RLS-scoped). */
export function RelatedEnquiries({ related, compact }: { related: LeadDetail["related"]; compact?: boolean }) {
  if (!related.length) {
    return <p className="text-sm text-fg-muted">{compact ? "None that you can see." : "No other enquiries from this number that you have access to."}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {related.map((r) => (
        <li key={r.id}>
          <Link href={`/leads/${r.id}`} className="block rounded-xl border border-line px-3.5 py-3 hover:bg-hover">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{humanizeCode(r.occasion_code)}</span>
              <StageBadge stage={r.stage} />
            </div>
            <p className="mt-1 text-xs text-fg-subtle">
              L-{r.lead_number} · Event {r.event_date ? formatCalendarDate(r.event_date) : "date unknown"} · Enquired {formatDate(r.acquired_at)}
              {r.owner ? ` · ${r.owner.full_name}` : " · Unassigned"}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
