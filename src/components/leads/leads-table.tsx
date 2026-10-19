"use client";

import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, type KeyboardEvent } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/field";
import { Menu, MenuContent, MenuLabel, MenuTrigger } from "@/components/ui/menu";
import { formatCalendarDate, formatDate, formatPhone, timeAgo } from "@/lib/domain/format";
import { guestRangeLabel, humanizeCode, platformLabel } from "@/lib/domain/labels";
import type { LeadWithOwner } from "@/lib/domain/types";
import { useLocalStorageState } from "@/lib/hooks";
import type { ListState, SortKey } from "@/lib/leads/filters";
import { cn } from "@/lib/utils";
import { FollowUpBadge, PriorityMark, StageBadge } from "./badges";

type ColumnKey =
  | "stage" | "owner" | "event" | "occasion" | "guests" | "menu" | "follow_up" | "source" | "campaign" | "acquired" | "imported" | "activity" | "number";

const COLUMNS: { key: ColumnKey; label: string; sort?: SortKey; managerOnly?: boolean; default: boolean }[] = [
  { key: "stage", label: "Stage", sort: "stage", default: true },
  { key: "owner", label: "Owner", managerOnly: true, default: true },
  { key: "event", label: "Event date", sort: "event", default: true },
  { key: "occasion", label: "Occasion", default: true },
  { key: "guests", label: "Guests", default: true },
  { key: "menu", label: "Menu", default: false },
  { key: "follow_up", label: "Next follow-up", sort: "follow_up", default: true },
  { key: "source", label: "Source", default: true },
  { key: "campaign", label: "Campaign", default: false },
  { key: "acquired", label: "Lead created", sort: "acquired", default: true },
  { key: "imported", label: "Added to CRM", sort: "imported", default: false },
  { key: "activity", label: "Last activity", sort: "activity", default: false },
  { key: "number", label: "Lead #", sort: "number", default: false },
];

function cell(lead: LeadWithOwner, key: ColumnKey) {
  switch (key) {
    case "stage":
      return <StageBadge stage={lead.stage} />;
    case "owner":
      return lead.owner ? <span className="text-fg">{lead.owner.full_name}</span> : <span className="text-fg-subtle">Unassigned</span>;
    case "event":
      return lead.event_date ? (
        formatCalendarDate(lead.event_date)
      ) : lead.event_date_status === "needs_review" ? (
        <span className="text-tint-amber-fg" title={lead.event_date_raw ?? undefined}>
          Needs review{lead.event_date_raw ? ` · “${lead.event_date_raw}”` : ""}
        </span>
      ) : (
        <span className="text-fg-subtle">—</span>
      );
    case "occasion":
      return humanizeCode(lead.occasion_code);
    case "guests":
      return guestRangeLabel(lead.guest_range);
    case "menu":
      return humanizeCode(lead.menu_code);
    case "follow_up":
      return <FollowUpBadge nextAt={lead.next_follow_up_at} compact />;
    case "source":
      return lead.source_system === "manual" ? `Manual · ${platformLabel(lead.platform)}` : platformLabel(lead.platform);
    case "campaign":
      return <span className="block max-w-56 truncate">{lead.campaign_name ?? "—"}</span>;
    case "acquired":
      return formatDate(lead.acquired_at);
    case "imported":
      return formatDate(lead.created_at);
    case "activity":
      return lead.last_activity_at ? timeAgo(lead.last_activity_at) : <span className="text-fg-subtle">None</span>;
    case "number":
      return `L-${lead.lead_number}`;
  }
}

export function LeadsTable({
  rows,
  manager,
  state,
  selected,
  allMatching,
  onToggle,
  onToggleAll,
  onSort,
}: {
  rows: LeadWithOwner[];
  manager: boolean;
  state: ListState;
  selected: Set<string>;
  allMatching: boolean;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  onSort: (sort: SortKey) => void;
}) {
  const router = useRouter();
  const [visible, setVisible] = useLocalStorageState<ColumnKey[]>(
    "leads-columns",
    COLUMNS.filter((c) => c.default).map((c) => c.key),
  );
  const columns = COLUMNS.filter((c) => visible.includes(c.key) && (manager || !c.managerOnly));
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const allChecked = allMatching || (rows.length > 0 && rows.every((r) => selected.has(r.id)));
  const someChecked = !allChecked && rows.some((r) => selected.has(r.id));

  function onKeyDown(e: KeyboardEvent<HTMLTableSectionElement>) {
    const rowsEls = Array.from(bodyRef.current?.querySelectorAll<HTMLTableRowElement>("tr[data-row]") ?? []);
    const index = rowsEls.findIndex((r) => r === document.activeElement);
    if (index < 0) return;
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      rowsEls[Math.min(rowsEls.length - 1, index + 1)]?.focus();
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      rowsEls[Math.max(0, index - 1)]?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      router.push(`/leads/${rowsEls[index].dataset.row}`);
    } else if (e.key === "x") {
      e.preventDefault();
      onToggle(rowsEls[index].dataset.row!);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <div className="flex items-center justify-between border-b border-line bg-subtle/60 px-3 py-1.5">
        <p className="text-xs text-fg-subtle">↑/↓ or j/k to move · Enter to open · x to select</p>
        <Menu>
          <MenuTrigger className={buttonVariants({ variant: "ghost", size: "sm" })}>
            <Columns3 /> Columns
          </MenuTrigger>
          <MenuContent className="w-56">
            <MenuLabel>Show columns</MenuLabel>
            {COLUMNS.filter((c) => manager || !c.managerOnly).map((c) => (
              <label key={c.key} className="flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm hover:bg-hover">
                <Checkbox
                  checked={visible.includes(c.key)}
                  onChange={() =>
                    setVisible(visible.includes(c.key) ? visible.filter((k) => k !== c.key) : [...visible, c.key])
                  }
                />
                {c.label}
              </label>
            ))}
          </MenuContent>
        </Menu>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-medium text-fg-muted">
              <th scope="col" className="w-12 py-2.5 pr-3 pl-4">
                <Checkbox
                  aria-label="Select all on this page"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = someChecked;
                  }}
                  onChange={(e) => onToggleAll(e.target.checked)}
                />
              </th>
              <th scope="col" className="py-2.5 pr-3 font-medium">
                <SortHeader label="Lead" sortKey="name" state={state} onSort={onSort} />
              </th>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">
                  {c.sort ? <SortHeader label={c.label} sortKey={c.sort} state={state} onSort={onSort} /> : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={bodyRef} onKeyDown={onKeyDown}>
            {rows.map((lead) => {
              const checked = allMatching || selected.has(lead.id);
              return (
                <tr
                  key={lead.id}
                  data-row={lead.id}
                  tabIndex={0}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("input,button,a")) return;
                    if (e.metaKey || e.ctrlKey) window.open(`/leads/${lead.id}`, "_blank");
                    else router.push(`/leads/${lead.id}`);
                  }}
                  className={cn(
                    "cursor-pointer border-b border-line last:border-0 hover:bg-hover/60 focus-visible:bg-hover focus-visible:outline-none",
                    checked && "bg-subtle",
                  )}
                >
                  <td className="py-3 pr-3 pl-4">
                    <Checkbox aria-label={`Select ${lead.customer_name}`} checked={checked} onChange={() => onToggle(lead.id)} />
                  </td>
                  <td className="max-w-64 py-3 pr-3">
                    <a href={`/leads/${lead.id}`} onClick={(e) => e.preventDefault()} className="block truncate font-medium text-fg" tabIndex={-1}>
                      {lead.customer_name}
                    </a>
                    <span className="flex items-center gap-2 text-xs text-fg-subtle">
                      <span className="tabular">{formatPhone(lead.phone_e164)}</span>
                      <PriorityMark priority={lead.priority} />
                    </span>
                  </td>
                  {columns.map((c) => (
                    <td key={c.key} className="px-3 py-3 whitespace-nowrap text-fg-muted">
                      {cell(lead, c.key)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortHeader({ label, sortKey, state, onSort }: { label: string; sortKey: SortKey; state: ListState; onSort: (s: SortKey) => void }) {
  const active = state.sort === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn("inline-flex items-center gap-1 rounded-md hover:text-fg", active && "text-fg")}
      aria-label={`Sort by ${label}`}
    >
      {label}
      {active ? state.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
    </button>
  );
}
