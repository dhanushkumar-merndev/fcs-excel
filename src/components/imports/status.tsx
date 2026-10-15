import { Badge } from "@/components/ui/badge";
import type { ImportBatchRow } from "@/lib/domain/types";

/** Processing batches without a recent heartbeat were interrupted and can be resumed safely. */
export function isInterrupted(batch: Pick<ImportBatchRow, "status" | "last_heartbeat_at">, now = Date.now()) {
  if (batch.status !== "processing" && batch.status !== "ready" && batch.status !== "staging") return false;
  const beat = batch.last_heartbeat_at ? Date.parse(batch.last_heartbeat_at) : 0;
  return now - beat > 90_000;
}

export function ImportStatusBadge({ batch }: { batch: Pick<ImportBatchRow, "status" | "last_heartbeat_at" | "failed_count"> }) {
  if (isInterrupted(batch)) return <Badge tint="amber">Paused — resume</Badge>;
  switch (batch.status) {
    case "completed":
      return <Badge tint="green">Completed</Badge>;
    case "completed_with_issues":
      return <Badge tint={batch.failed_count ? "red" : "amber"}>{batch.failed_count ? "Some rows failed" : "Completed with issues"}</Badge>;
    case "processing":
      return <Badge tint="blue">Importing…</Badge>;
    case "ready":
    case "staging":
      return <Badge tint="blue">Preparing</Badge>;
    case "cancelled":
      return <Badge>Discarded</Badge>;
    default:
      return <Badge>{batch.status}</Badge>;
  }
}
