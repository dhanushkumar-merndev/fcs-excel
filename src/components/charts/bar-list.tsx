import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BarItem = { key: string; label: ReactNode; value: number; href?: string; detail?: string };

/**
 * Horizontal single-series bars for comparing magnitude across categories. Each row is a
 * labelled, clickable drill-down to the underlying leads; the value is always printed, so
 * the list doubles as its own table view.
 */
export function BarList({ items, empty = "No data for this period.", valueLabel }: { items: BarItem[]; empty?: string; valueLabel?: string }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-fg-muted">{empty}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="flex flex-col">
      {items.map((item) => {
        const pct = (item.value / max) * 100;
        const content = (
          <>
            <span className="min-w-0 truncate text-[13px] text-fg">{item.label}</span>
            <span className="relative h-5">
              <span
                className="absolute inset-y-0.5 left-0 rounded-r-[4px] bg-chart-1"
                style={{ width: item.value > 0 ? `max(${pct}%, 3px)` : 0 }}
              />
            </span>
            <span className="tabular text-right text-[13px] font-medium text-fg">
              {item.value.toLocaleString("en-IN")}
              {item.detail ? <span className="ml-1.5 font-normal text-fg-subtle">{item.detail}</span> : null}
            </span>
          </>
        );
        const rowClass = "grid grid-cols-[minmax(0,38%)_1fr_auto] items-center gap-3 rounded-lg px-2 py-1.5";
        return (
          <li key={item.key}>
            {item.href ? (
              <Link
                href={item.href}
                className={cn(rowClass, "hover:bg-hover focus-visible:bg-hover")}
                title={`${typeof item.label === "string" ? item.label : ""}: ${item.value.toLocaleString("en-IN")}${valueLabel ? ` ${valueLabel}` : ""} — open these leads`}
              >
                {content}
              </Link>
            ) : (
              <div className={rowClass}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
