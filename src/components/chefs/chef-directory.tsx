"use client";

import { CalendarClock, ChefHat, MapPin, Phone, RefreshCw, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import {
  chefTypeLabel,
  countByStatus,
  matchesQuery,
  sortChefs,
  type Chef,
  type ChefDirectory,
  type ChefStatus,
} from "@/lib/chefpy/directory";
import { formatDateTime, formatINR, formatPhone, timeAgo } from "@/lib/domain/format";
import type { Tint } from "@/lib/domain/stages";
import { cn } from "@/lib/utils";

const STATUS: Record<ChefStatus, { label: string; tint: Tint }> = {
  available: { label: "Available", tint: "green" },
  booked: { label: "Booked", tint: "orange" },
  offline: { label: "Offline", tint: "gray" },
  pending: { label: "Awaiting approval", tint: "amber" },
  rejected: { label: "Rejected", tint: "red" },
};

type Filter = "all" | ChefStatus;

export function ChefDirectoryView({ directory }: { directory: ChefDirectory }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [filter, setFilter] = useState<Filter>("all");
  const [region, setRegion] = useState("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => countByStatus(directory.chefs), [directory.chefs]);
  const regions = useMemo(
    () => [...new Set(directory.chefs.map((c) => c.region).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [directory.chefs],
  );
  const visible = useMemo(
    () =>
      sortChefs(
        directory.chefs.filter(
          (c) => (filter === "all" || c.status === filter) && (region === "all" || c.region === region) && matchesQuery(c, query),
        ),
      ),
    [directory.chefs, filter, region, query],
  );

  const tiles: { key: Filter; label: string; value: number; tone?: string }[] = [
    { key: "all", label: "Registered chefs", value: counts.total },
    { key: "available", label: "Available", value: counts.available, tone: "text-success" },
    { key: "booked", label: "Booked", value: counts.booked, tone: "text-tint-orange-fg" },
    { key: "pending", label: "Awaiting approval", value: counts.pending, tone: "text-tint-amber-fg" },
  ];

  return (
    <div className="pb-8">
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setFilter((f) => (f === t.key ? "all" : t.key))}
            aria-pressed={filter === t.key}
            className={cn(
              "flex flex-col rounded-2xl border bg-surface p-4 text-left transition-colors hover:bg-hover/60",
              filter === t.key ? "border-fg-subtle" : "border-line",
            )}
          >
            <span className="text-[13px] text-fg-muted">{t.label}</span>
            <span className={cn("mt-2 text-[28px] leading-none font-semibold tracking-tight", t.value > 0 && t.tone)}>
              {t.value.toLocaleString("en-IN")}
            </span>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative sm:max-w-sm sm:flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, cuisine, location, phone"
            aria-label="Search chefs"
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Status" wrapperClassName="flex-1 sm:w-44 sm:flex-none">
            <option value="all">All statuses</option>
            {(Object.keys(STATUS) as ChefStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS[s].label} ({counts[s]})
              </option>
            ))}
          </Select>
          <Select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region" wrapperClassName="flex-1 sm:w-40 sm:flex-none">
            <option value="all">All regions</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <span className="text-xs text-fg-subtle">Updated {timeAgo(directory.generated_at)}</span>
          <Button variant="secondary" size="sm" loading={refreshing} onClick={() => startRefresh(() => router.refresh())}>
            <RefreshCw /> Refresh
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ChefHat />}
            title={directory.chefs.length === 0 ? "No chefs have registered yet" : "No chefs match"}
            description={directory.chefs.length === 0 ? "Chefs appear here once they sign up in Chefpy." : "Try another status, region or search."}
          />
        </Card>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {visible.map((c) => (
            <li key={c.id}>
              <ChefCard chef={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChefCard({ chef: c }: { chef: Chef }) {
  const s = STATUS[c.status];
  const type = chefTypeLabel(c.chef_type);
  const place = [c.location, c.region].filter(Boolean).join(", ");
  return (
    <Card className="h-full p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-fg">{c.name}</h3>
          <p className="mt-0.5 truncate text-[13px] text-fg-muted">
            {[type, c.cuisine, c.experience ? `${c.experience} yr${c.experience === 1 ? "" : "s"} experience` : ""].filter(Boolean).join(" · ") ||
              "Profile not completed"}
          </p>
        </div>
        <Badge tint={s.tint} dot>
          {s.label}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-fg-muted">
        {c.phone ? (
          <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 hover:text-fg">
            <Phone className="size-3.5" /> {formatPhone(c.phone)}
          </a>
        ) : null}
        {place ? (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-3.5" /> {place}
          </span>
        ) : null}
        {c.open_bids > 0 ? <span>{c.open_bids} open bid{c.open_bids === 1 ? "" : "s"}</span> : null}
        {c.registered_at ? <span>Joined {timeAgo(c.registered_at)}</span> : null}
      </div>

      {c.current ? (
        <div className="mt-3 rounded-xl bg-tint-orange/60 px-3 py-2.5 text-[13px] text-tint-orange-fg">
          <p className="flex items-center gap-1.5 font-medium">
            <CalendarClock className="size-3.5" />
            {c.current.kind === "awarded_bid" ? "Won bid" : "Booking"} {c.current.code} · {c.current.service}
          </p>
          <p className="mt-0.5 opacity-90">
            {formatDateTime(c.current.scheduled_start)} – {formatDateTime(c.current.scheduled_end)}
            {c.current.customer ? ` · ${c.current.customer}` : ""}
            {c.current.amount !== null ? ` · ${formatINR(c.current.amount)}` : ""}
          </p>
        </div>
      ) : null}
    </Card>
  );
}
