"use client";

import { Download, FileSpreadsheet, Plus, SlidersHorizontal, Upload, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { PageContainer, PageHeader } from "@/components/shell/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { EmptyState } from "@/components/ui/states";
import type { LeadWithOwner, Staff, WorkloadRow } from "@/lib/domain/types";
import { activeFilterCount, parseExplicitFilters, SORTS, toRpcFilters, VIEWS, type ListState, type SortKey, type ViewKey } from "@/lib/leads/filters";
import type { FilterOptions } from "@/lib/leads/queries";
import { cn, formatCount } from "@/lib/utils";
import { FilterChips, FiltersSheet } from "./filters-sheet";
import { LeadActionsProvider, useLeadActions } from "./lead-actions";
import { LeadCard } from "./lead-card";
import { LeadsTable } from "./leads-table";
import { SearchInput } from "./search-input";

export function LeadsBrowser(props: {
  staff: Staff;
  state: ListState;
  rows: LeadWithOwner[];
  total: number;
  options: FilterOptions;
  workload: WorkloadRow[];
  canExport: boolean;
}) {
  const manager = props.staff.role !== "salesperson";
  return (
    <LeadActionsProvider userId={props.staff.id} workload={props.workload} canAssign={manager}>
      <Browser {...props} manager={manager} />
    </LeadActionsProvider>
  );
}

function Browser({
  staff,
  state,
  rows,
  total,
  options,
  workload,
  canExport,
  manager,
}: Parameters<typeof LeadsBrowser>[0] & { manager: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const actions = useLeadActions();

  const pageKey = searchParams.toString();
  const lastKey = useRef(pageKey);
  useEffect(() => {
    if (lastKey.current !== pageKey) {
      lastKey.current = pageKey;
      setSelected(new Set());
      setAllMatching(false);
    }
  }, [pageKey]);

  function navigate(mutate: (p: URLSearchParams) => void, resetPage = true) {
    const next = new URLSearchParams(searchParams.toString());
    mutate(next);
    if (resetPage) next.delete("page");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  const views = (Object.keys(VIEWS) as ViewKey[]).filter(
    (v) => v !== "recently_assigned" && (manager || !VIEWS[v].managerOnly) && !(v === "mine" && !manager),
  );
  const explicit = useMemo(() => parseExplicitFilters(searchParams), [searchParams]);
  const filterCount = activeFilterCount(explicit);
  const from = total === 0 ? 0 : (state.page - 1) * state.size + 1;
  const to = Math.min(total, state.page * state.size);
  const pages = Math.max(1, Math.ceil(total / state.size));

  const selectionCount = allMatching ? total : selected.size;
  const exportBase = useMemo(() => {
    const p = new URLSearchParams(searchParams.toString());
    p.delete("page");
    p.delete("size");
    return p;
  }, [searchParams]);

  function exportHref(format: "xlsx" | "csv", scope: "selected" | "filtered", layout: "crm" | "source" = "crm") {
    const p = new URLSearchParams(exportBase.toString());
    p.set("format", format);
    p.set("layout", layout);
    p.set("scope", scope);
    if (scope === "selected") p.set("ids", [...selected].join(","));
    return `/api/exports/leads?${p.toString()}`;
  }

  return (
    <PageContainer>
      <PageHeader
        title="Leads"
        description={
          <span className="tabular">
            {formatCount(total)} {total === 1 ? "enquiry" : "enquiries"}
            {state.view ? ` · ${VIEWS[state.view].label}` : ""}
          </span>
        }
        actions={
          <>
            {canExport ? (
              <Menu>
                <MenuTrigger className={buttonVariants({ variant: "secondary", size: "md" })}>
                  <Download /> <span className="hidden sm:inline">Export</span>
                </MenuTrigger>
                <MenuContent className="w-72">
                  <MenuLabel>All {formatCount(total)} leads matching filters</MenuLabel>
                  <MenuItem icon={<FileSpreadsheet />} asChild>
                    <a href={exportHref("xlsx", "filtered")}>Excel (.xlsx)</a>
                  </MenuItem>
                  <MenuItem icon={<FileSpreadsheet />} asChild>
                    <a href={exportHref("csv", "filtered")}>CSV</a>
                  </MenuItem>
                  <MenuItem icon={<FileSpreadsheet />} asChild>
                    <a href={exportHref("xlsx", "filtered", "source")}>Original template (.xlsx)</a>
                  </MenuItem>
                  {selected.size > 0 && !allMatching ? (
                    <>
                      <MenuSeparator />
                      <MenuLabel>{selected.size} selected on this page</MenuLabel>
                      <MenuItem icon={<FileSpreadsheet />} asChild>
                        <a href={exportHref("xlsx", "selected")}>Excel (.xlsx)</a>
                      </MenuItem>
                      <MenuItem icon={<FileSpreadsheet />} asChild>
                        <a href={exportHref("csv", "selected")}>CSV</a>
                      </MenuItem>
                    </>
                  ) : null}
                </MenuContent>
              </Menu>
            ) : null}
            {manager ? (
              <>
                <Link href="/imports/new" className={cn(buttonVariants({ variant: "secondary" }), "hidden sm:inline-flex")}>
                  <Upload /> Import
                </Link>
                <Link href="/leads/new" className={buttonVariants({ variant: "primary" })}>
                  <Plus /> <span className="hidden sm:inline">New lead</span>
                  <span className="sm:hidden">New</span>
                </Link>
              </>
            ) : null}
          </>
        }
      />

      <nav aria-label="Saved views" className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        <ViewPill active={!state.view && filterCount === 0 && !state.filters.q} onClick={() => navigate((p) => [...p.keys()].forEach((k) => p.delete(k)))}>
          All
        </ViewPill>
        {views
          .filter((v) => v !== "all")
          .map((v) => (
            <ViewPill
              key={v}
              active={state.view === v}
              onClick={() =>
                navigate((p) => {
                  [...p.keys()].forEach((k) => k !== "q" && p.delete(k));
                  p.set("view", v);
                })
              }
            >
              {VIEWS[v].label}
            </ViewPill>
          ))}
      </nav>

      <div className="mb-3 flex items-center gap-2">
        <SearchInput
          defaultValue={state.filters.q ?? ""}
          onSearch={(q) => navigate((p) => (q ? p.set("q", q) : p.delete("q")))}
        />
        <Button variant="secondary" onClick={() => setFiltersOpen(true)} aria-label="Filters" className="shrink-0">
          <SlidersHorizontal />
          <span className="hidden sm:inline">Filters</span>
          {filterCount > 0 ? (
            <span className="tabular flex size-5 items-center justify-center rounded-full bg-fg text-[11px] text-canvas">{filterCount}</span>
          ) : null}
        </Button>
        <Select
          aria-label="Sort by"
          wrapperClassName="hidden shrink-0 sm:block"
          className="w-auto min-w-44"
          value={`${state.sort}:${state.dir}`}
          onChange={(e) => {
            const [sort, dir] = e.target.value.split(":");
            navigate((p) => {
              p.set("sort", sort);
              p.set("dir", dir);
            });
          }}
        >
          {(Object.keys(SORTS) as SortKey[]).flatMap((key) => [
            <option key={`${key}:desc`} value={`${key}:desc`}>
              {SORTS[key].label} {key === "name" ? "(Z–A)" : key === "stage" ? "(last first)" : "(newest)"}
            </option>,
            <option key={`${key}:asc`} value={`${key}:asc`}>
              {SORTS[key].label} {key === "name" ? "(A–Z)" : key === "stage" ? "(first first)" : "(oldest)"}
            </option>,
          ])}
        </Select>
      </div>

      <FilterChips
        filters={explicit}
        view={state.view}
        workload={workload}
        onRemove={(keys) => navigate((p) => keys.forEach((k) => p.delete(k)))}
      />

      <div className={cn("transition-opacity", pending && "pointer-events-none opacity-60")} aria-busy={pending}>
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-line">
            <EmptyState
              title={filterCount > 0 || state.filters.q || state.view ? "No leads match" : "No leads yet"}
              description={
                filterCount > 0 || state.filters.q || state.view
                  ? "Try removing a filter or searching for something else."
                  : manager
                    ? "Import a spreadsheet of Meta leads or add one manually."
                    : "Leads assigned to you will appear here."
              }
              action={
                filterCount > 0 || state.filters.q || state.view ? (
                  <Button variant="secondary" onClick={() => navigate((p) => [...p.keys()].forEach((k) => p.delete(k)))}>
                    Clear filters
                  </Button>
                ) : manager ? (
                  <Link href="/imports/new" className={buttonVariants()}>
                    <Upload /> Import leads
                  </Link>
                ) : null
              }
            />
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <LeadsTable
                rows={rows}
                manager={manager}
                state={state}
                selected={selected}
                allMatching={allMatching}
                onToggle={(id) =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    setAllMatching(false);
                    return next;
                  })
                }
                onToggleAll={(checked) => {
                  setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set());
                  setAllMatching(false);
                }}
                onSort={(sort) =>
                  navigate((p) => {
                    const dir = state.sort === sort ? (state.dir === "asc" ? "desc" : "asc") : SORTS[sort].defaultDir;
                    p.set("sort", sort);
                    p.set("dir", dir);
                  })
                }
              />
            </div>
            <ul className="flex flex-col gap-2 md:hidden">
              {rows.map((row) => (
                <li key={row.id}>
                  <LeadCard lead={row} showOwner={manager} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {total > 0 ? (
        <div className="mt-4 flex flex-col items-center justify-between gap-3 text-sm text-fg-muted sm:flex-row">
          <p className="tabular">
            Showing {formatCount(from)}–{formatCount(to)} of {formatCount(total)}
          </p>
          <div className="flex items-center gap-2">
            <Select
              aria-label="Rows per page"
              className="h-9 w-auto"
              value={String(state.size)}
              onChange={(e) => navigate((p) => p.set("size", e.target.value))}
            >
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} per page
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              size="sm"
              disabled={state.page <= 1 || pending}
              onClick={() => navigate((p) => p.set("page", String(state.page - 1)), false)}
            >
              Previous
            </Button>
            <span className="tabular px-1">
              {state.page} / {pages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={state.page >= pages || pending}
              onClick={() => navigate((p) => p.set("page", String(state.page + 1)), false)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      {selectionCount > 0 ? (
        <div className="pb-safe fixed inset-x-0 bottom-16 z-40 px-3 md:bottom-6">
          <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 shadow-soft">
            <p className="tabular text-sm font-medium">
              {allMatching ? `All ${formatCount(total)} matching leads` : `${selected.size} selected`}
            </p>
            {!allMatching && selected.size === rows.length && total > rows.length ? (
              <button type="button" className="text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline" onClick={() => setAllMatching(true)}>
                Select all {formatCount(total)} matching
              </button>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              {manager ? (
                <Button
                  size="sm"
                  onClick={() =>
                    actions.assign(
                      allMatching
                        ? { kind: "filters", filters: toRpcFilters(state.filters), count: total }
                        : { kind: "ids", ids: [...selected] },
                    )
                  }
                >
                  <UserPlus /> Assign
                </Button>
              ) : null}
              {canExport ? (
                <a
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                  href={allMatching ? exportHref("xlsx", "filtered") : exportHref("xlsx", "selected")}
                >
                  <Download /> Export {allMatching ? "all" : "selected"}
                </a>
              ) : null}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Clear selection"
                onClick={() => {
                  setSelected(new Set());
                  setAllMatching(false);
                }}
              >
                <X />
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <FiltersSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={explicit}
        options={options}
        workload={workload}
        manager={manager}
        currentUserId={staff.id}
        onApply={(params) =>
          navigate((p) => {
            const keep = { q: p.get("q"), view: p.get("view"), sort: p.get("sort"), dir: p.get("dir"), size: p.get("size") };
            [...p.keys()].forEach((k) => p.delete(k));
            for (const [k, v] of Object.entries(keep)) if (v) p.set(k, v);
            params.forEach((v, k) => p.set(k, v));
          })
        }
      />
    </PageContainer>
  );
}

function ViewPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-9 shrink-0 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors",
        active ? "bg-fg text-canvas" : "bg-subtle text-fg-muted hover:bg-hover hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
