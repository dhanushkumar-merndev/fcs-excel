"use client";

import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { formatCalendarDate } from "@/lib/domain/format";
import { callOutcomeLabel, humanizeCode, platformLabel } from "@/lib/domain/labels";
import { STAGES, stageLabel } from "@/lib/domain/stages";
import type { WorkloadRow } from "@/lib/domain/types";
import { filtersToParams, VIEWS, type LeadFilters, type ViewKey } from "@/lib/leads/filters";
import type { FilterOptions } from "@/lib/leads/queries";
import { cn } from "@/lib/utils";

const FOLLOW_UP_OPTIONS = [
  ["", "Any"],
  ["overdue", "Overdue"],
  ["today", "Due today"],
  ["upcoming", "Upcoming"],
  ["none", "No follow-up"],
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line py-4 first:pt-0 last:border-0">
      <h3 className="mb-2.5 text-[13px] font-medium">{title}</h3>
      {children}
    </section>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-9 rounded-full border px-3 text-[13px] transition-colors",
        active ? "border-fg bg-fg text-canvas" : "border-line hover:bg-hover",
      )}
    >
      {children}
    </button>
  );
}

function toggle(list: string[] | undefined, value: string) {
  const set = new Set(list ?? []);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return set.size ? [...set] : undefined;
}

function CheckList({
  values,
  selected,
  onChange,
  label,
}: {
  values: string[];
  selected: string[] | undefined;
  onChange: (next: string[] | undefined) => void;
  label: (v: string) => string;
}) {
  const [query, setQuery] = useState("");
  if (!values.length) return <p className="text-[13px] text-fg-subtle">No values yet.</p>;
  const shown = values.filter((v) => label(v).toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="flex flex-col gap-2">
      {values.length > 8 ? <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter…" aria-label="Filter options" /> : null}
      <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
        {shown.map((v) => (
          <label key={v} className="flex min-h-9 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-hover">
            <Checkbox checked={selected?.includes(v) ?? false} onChange={() => onChange(toggle(selected, v))} />
            <span className="truncate">{label(v)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function DateRange({
  from,
  to,
  onChange,
  idPrefix,
}: {
  from?: string;
  to?: string;
  onChange: (from?: string, to?: string) => void;
  idPrefix: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1 text-xs text-fg-muted" htmlFor={`${idPrefix}-from`}>
        From
        <Input id={`${idPrefix}-from`} type="date" value={from ?? ""} onChange={(e) => onChange(e.target.value || undefined, to)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-fg-muted" htmlFor={`${idPrefix}-to`}>
        To
        <Input id={`${idPrefix}-to`} type="date" value={to ?? ""} min={from} onChange={(e) => onChange(from, e.target.value || undefined)} />
      </label>
    </div>
  );
}

export function FiltersSheet({
  open,
  onOpenChange,
  filters,
  options,
  workload,
  manager,
  currentUserId,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: LeadFilters;
  options: FilterOptions;
  workload: WorkloadRow[];
  manager: boolean;
  currentUserId: string;
  onApply: (params: URLSearchParams) => void;
}) {
  const [draft, setDraft] = useState<LeadFilters>(filters);
  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);
  const set = (patch: Partial<LeadFilters>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Filters"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => setDraft({ q: filters.q })}>
            Clear all
          </Button>
          <Button
            onClick={() => {
              const { q: _q, ...rest } = draft;
              void _q;
              onApply(filtersToParams(rest));
              onOpenChange(false);
            }}
          >
            Show results
          </Button>
        </>
      }
    >
      <div>
        {manager ? (
          <Section title="Owner">
            <div className="flex flex-wrap gap-2">
              <Chip active={draft.owner?.includes("me") ?? false} onClick={() => set({ owner: toggle(draft.owner, "me") })}>
                Me
              </Chip>
              <Chip active={draft.owner?.includes("unassigned") ?? false} onClick={() => set({ owner: toggle(draft.owner, "unassigned") })}>
                Unassigned
              </Chip>
              {workload
                .filter((w) => w.id !== currentUserId)
                .map((w) => (
                  <Chip key={w.id} active={draft.owner?.includes(w.id) ?? false} onClick={() => set({ owner: toggle(draft.owner, w.id) })}>
                    {w.full_name}
                  </Chip>
                ))}
            </div>
          </Section>
        ) : null}
        <Section title="Stage">
          <div className="flex flex-wrap gap-2">
            {STAGES.map((s) => (
              <Chip key={s.value} active={draft.stage?.includes(s.value) ?? false} onClick={() => set({ stage: toggle(draft.stage, s.value) })}>
                {s.label}
              </Chip>
            ))}
          </div>
        </Section>
        <Section title="Follow-up">
          <div className="flex flex-wrap gap-2">
            {FOLLOW_UP_OPTIONS.map(([value, label]) => (
              <Chip
                key={value || "any"}
                active={(draft.follow_up ?? "") === value}
                onClick={() => set({ follow_up: (value || undefined) as LeadFilters["follow_up"] })}
              >
                {label}
              </Chip>
            ))}
          </div>
        </Section>
        <Section title="Event date">
          <DateRange idPrefix="event" from={draft.event_from} to={draft.event_to} onChange={(f, t) => set({ event_from: f, event_to: t })} />
        </Section>
        <Section title="Lead created (original time)">
          <DateRange idPrefix="acq" from={draft.acquired_from} to={draft.acquired_to} onChange={(f, t) => set({ acquired_from: f, acquired_to: t })} />
        </Section>
        <Section title="Added to CRM (import time)">
          <DateRange idPrefix="imp" from={draft.imported_from} to={draft.imported_to} onChange={(f, t) => set({ imported_from: f, imported_to: t })} />
        </Section>
        <Section title="Platform">
          <div className="flex flex-wrap gap-2">
            {options.platforms.length ? (
              options.platforms.map((p) => (
                <Chip key={p} active={draft.platform?.includes(p) ?? false} onClick={() => set({ platform: toggle(draft.platform, p) })}>
                  {platformLabel(p)}
                </Chip>
              ))
            ) : (
              <p className="text-[13px] text-fg-subtle">No values yet.</p>
            )}
          </div>
        </Section>
        <Section title="Campaign">
          <CheckList values={options.campaigns} selected={draft.campaign} onChange={(v) => set({ campaign: v })} label={(v) => v} />
        </Section>
        <Section title="Occasion">
          <CheckList values={options.occasions} selected={draft.occasion} onChange={(v) => set({ occasion: v })} label={humanizeCode} />
        </Section>
        <Section title="Menu">
          <CheckList values={options.menus} selected={draft.menu} onChange={(v) => set({ menu: v })} label={humanizeCode} />
        </Section>
        <Section title="Ad">
          <CheckList values={options.ads} selected={draft.ad} onChange={(v) => set({ ad: v })} label={(v) => v} />
        </Section>
        <Section title="More">
          <div className="flex flex-col gap-1">
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <Checkbox checked={draft.review ?? false} onChange={(e) => set({ review: e.target.checked || undefined })} />
              Needs review (date or details)
            </label>
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <Checkbox checked={draft.no_contact ?? false} onChange={(e) => set({ no_contact: e.target.checked || undefined })} />
              Awaiting first logged call
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["high", "normal", "low"] as const).map((p) => (
                <Chip key={p} active={draft.priority?.includes(p) ?? false} onClick={() => set({ priority: toggle(draft.priority, p) })}>
                  {p[0].toUpperCase() + p.slice(1)} priority
                </Chip>
              ))}
            </div>
          </div>
        </Section>
      </div>
    </Sheet>
  );
}

type ChipDef = { key: string; label: string; params: string[] };

export function FilterChips({
  filters,
  view,
  workload,
  onRemove,
}: {
  filters: LeadFilters;
  view: ViewKey | null;
  workload: WorkloadRow[];
  onRemove: (params: string[]) => void;
}) {
  const name = (id: string) => (id === "me" ? "Me" : id === "unassigned" ? "Unassigned" : workload.find((w) => w.id === id)?.full_name ?? "Someone");
  const range = (from?: string, to?: string) =>
    from && to ? `${formatCalendarDate(from)} – ${formatCalendarDate(to)}` : from ? `from ${formatCalendarDate(from)}` : `until ${formatCalendarDate(to)}`;
  const chips: ChipDef[] = [];
  if (filters.owner) chips.push({ key: "owner", label: `Owner: ${filters.owner.map(name).join(", ")}`, params: ["owner"] });
  if (filters.stage) chips.push({ key: "stage", label: `Stage: ${filters.stage.map(stageLabel).join(", ")}`, params: ["stage"] });
  if (filters.stage_group) chips.push({ key: "sg", label: filters.stage_group === "open" ? "Open enquiries" : "Closed enquiries", params: ["stage_group"] });
  if (filters.follow_up) chips.push({ key: "fu", label: `Follow-up: ${FOLLOW_UP_OPTIONS.find(([v]) => v === filters.follow_up)?.[1] ?? "Due"}`, params: ["follow_up"] });
  if (filters.event_from || filters.event_to) chips.push({ key: "ev", label: `Event ${range(filters.event_from, filters.event_to)}`, params: ["event_from", "event_to"] });
  if (filters.acquired_from || filters.acquired_to) chips.push({ key: "acq", label: `Created ${range(filters.acquired_from, filters.acquired_to)}`, params: ["acquired_from", "acquired_to"] });
  if (filters.imported_from || filters.imported_to) chips.push({ key: "imp", label: `Added ${range(filters.imported_from, filters.imported_to)}`, params: ["imported_from", "imported_to"] });
  if (filters.closed_from || filters.closed_to) chips.push({ key: "cl", label: `Closed ${range(filters.closed_from, filters.closed_to)}`, params: ["closed_from", "closed_to"] });
  if (filters.platform) chips.push({ key: "pl", label: `Platform: ${filters.platform.map(platformLabel).join(", ")}`, params: ["platform"] });
  if (filters.campaign) chips.push({ key: "ca", label: `Campaign: ${filters.campaign.map((c) => c || "(none)").join(", ")}`, params: ["campaign"] });
  if (filters.ad) chips.push({ key: "ad", label: `Ad: ${filters.ad.map((c) => c || "(none)").join(", ")}`, params: ["ad"] });
  if (filters.occasion) chips.push({ key: "oc", label: `Occasion: ${filters.occasion.map((c) => (c ? humanizeCode(c) : "(none)")).join(", ")}`, params: ["occasion"] });
  if (filters.menu) chips.push({ key: "me", label: `Menu: ${filters.menu.map(humanizeCode).join(", ")}`, params: ["menu"] });
  if (filters.priority) chips.push({ key: "pr", label: `Priority: ${filters.priority.join(", ")}`, params: ["priority"] });
  if (filters.review) chips.push({ key: "rv", label: "Needs review", params: ["review"] });
  if (filters.no_contact) chips.push({ key: "nc", label: "Awaiting first call", params: ["no_contact"] });
  if (filters.import_batch) chips.push({ key: "ib", label: "From one import", params: ["import"] });
  if (filters.phone) chips.push({ key: "ph", label: `Phone ${filters.phone}`, params: ["phone"] });
  if (filters.source) chips.push({ key: "src", label: filters.source === "manual" ? "Added manually" : "Imported from Meta", params: ["source"] });
  if (filters.activity) {
    const a = filters.activity;
    const what =
      a.type === "call" ? `Calls${a.outcome ? `: ${callOutcomeLabel(a.outcome)}` : ""}` : a.type === "dial" ? "Dial taps" : a.type === "booked" ? "Booked" : "Follow-ups completed";
    chips.push({ key: "act", label: `${what}${a.from || a.to ? ` ${range(a.from, a.to)}` : ""}`, params: ["activity", "activity_outcome", "activity_from", "activity_to", "activity_actor"] });
  }
  if (!chips.length) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {view ? <span className="text-xs text-fg-subtle">{VIEWS[view].label} +</span> : null}
      {chips.map((chip) => (
        <span key={chip.key} className="inline-flex h-8 max-w-full items-center gap-1 rounded-full bg-subtle pr-1 pl-3 text-[13px]">
          <span className="truncate">{chip.label}</span>
          <button
            type="button"
            aria-label={`Remove filter: ${chip.label}`}
            onClick={() => onRemove(chip.params)}
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-fg-subtle hover:bg-hover hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      {chips.length > 1 ? (
        <button type="button" className="px-2 text-[13px] text-fg-muted hover:text-fg hover:underline" onClick={() => onRemove(chips.flatMap((c) => c.params))}>
          Clear all
        </button>
      ) : null}
    </div>
  );
}
