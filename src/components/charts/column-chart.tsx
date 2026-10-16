"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export type ColumnPoint = { key: string; label: string; shortLabel: string; value: number; href?: string; detail?: string };

function niceMax(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : String(n));

/**
 * Single-series columns over time (e.g. leads per day). Hover/focus shows a tooltip; clicking a
 * column drills down to its leads. A "Table" toggle shows the same numbers as a table.
 */
export function ColumnChart({ points, ariaLabel, unit = "leads" }: { points: ColumnPoint[]; ariaLabel: string; unit?: string }) {
  const router = useRouter();
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = useMemo(() => niceMax(Math.max(0, ...points.map((p) => p.value))), [points]);
  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));

  if (!points.length) return <p className="py-10 text-center text-sm text-fg-muted">No data for this period.</p>;

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button type="button" className="text-xs text-fg-muted hover:text-fg hover:underline" onClick={() => setTable(!table)} aria-pressed={table}>
          {table ? "Show chart" : "Show table"}
        </button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-y-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-left text-xs text-fg-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 text-right font-medium">{unit[0].toUpperCase() + unit.slice(1)}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.key} className="border-t border-line">
                  <td className="px-3 py-1.5">{p.label}</td>
                  <td className="tabular px-3 py-1.5 text-right">
                    {p.value.toLocaleString("en-IN")}
                    {p.detail ? <span className="ml-2 text-fg-subtle">{p.detail}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative flex gap-2" role="img" aria-label={ariaLabel}>
          <div className="tabular flex h-48 flex-col justify-between pb-0 text-right text-[11px] text-fg-subtle" aria-hidden>
            {[...ticks].reverse().map((t) => (
              <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
                {compact(t)}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative h-48">
              {ticks.map((t) => (
                <div key={t} aria-hidden className="absolute inset-x-0 border-t border-line" style={{ bottom: `${(t / max) * 100}%` }} />
              ))}
              <div className="absolute inset-0 flex items-end gap-[2px]">
                {points.map((p, i) => (
                  <button
                    key={p.key}
                    type="button"
                    className="group relative flex h-full flex-1 items-end justify-center focus-visible:outline-none"
                    onMouseEnter={() => setActive(i)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    onClick={() => p.href && router.push(p.href)}
                    aria-label={`${p.label}: ${p.value} ${unit}${p.detail ? `, ${p.detail}` : ""}`}
                  >
                    <span
                      className={cn(
                        "block w-full max-w-6 rounded-t-[4px] bg-chart-1 transition-opacity",
                        active !== null && active !== i && "opacity-40",
                        "group-focus-visible:ring-2 group-focus-visible:ring-ring",
                      )}
                      style={{ height: p.value > 0 ? `max(${(p.value / max) * 100}%, 2px)` : 0 }}
                    />
                  </button>
                ))}
              </div>
              {active !== null ? (
                <div
                  className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-soft"
                  style={{ left: `${((active + 0.5) / points.length) * 100}%` }}
                >
                  <p className="font-medium">{points[active].label}</p>
                  <p className="tabular text-fg-muted">
                    {points[active].value.toLocaleString("en-IN")} {unit}
                    {points[active].detail ? ` · ${points[active].detail}` : ""}
                  </p>
                </div>
              ) : null}
            </div>
            {/* Labels sit centred under their column and may be wider than it, so they never clip. */}
            <div className="relative mt-1.5 h-4 text-[11px] text-fg-subtle" aria-hidden>
              {points.map((p, i) =>
                i % labelEvery === 0 ? (
                  <span key={p.key} className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: `${((i + 0.5) / points.length) * 100}%` }}>
                    {p.shortLabel}
                  </span>
                ) : null,
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
