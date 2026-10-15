"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/field";
import { formatDue, fromIstInputValue, toIstInputValue } from "@/lib/domain/format";
import { quickSlots } from "@/lib/domain/schedule";
import { cn } from "@/lib/utils";

export type TimeChoice = { key: string; at: Date | null };

/** Chips for quick IST times plus a custom date-time input (native picker on phones). */
export function TimePicker({
  value,
  onChange,
  allowNone,
  idPrefix,
}: {
  value: TimeChoice;
  onChange: (next: TimeChoice) => void;
  allowNone?: boolean;
  idPrefix: string;
}) {
  const slots = useMemo(() => quickSlots(), []);
  const chip = (active: boolean) =>
    cn(
      "h-10 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
      active ? "border-fg bg-fg text-canvas" : "border-line bg-surface text-fg hover:bg-hover",
    );
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="When">
        {allowNone ? (
          <button type="button" role="radio" aria-checked={value.key === "none"} className={chip(value.key === "none")} onClick={() => onChange({ key: "none", at: null })}>
            No follow-up
          </button>
        ) : null}
        {slots.map((slot) => (
          <button
            key={slot.key}
            type="button"
            role="radio"
            aria-checked={value.key === slot.key}
            className={chip(value.key === slot.key)}
            onClick={() => onChange({ key: slot.key, at: slot.at })}
          >
            {slot.label}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={value.key === "custom"}
          className={chip(value.key === "custom")}
          onClick={() => onChange({ key: "custom", at: value.at ?? slots[0]?.at ?? new Date(Date.now() + 3600e3) })}
        >
          Pick date &amp; time
        </button>
      </div>
      {value.key === "custom" ? (
        <Input
          id={`${idPrefix}-custom`}
          type="datetime-local"
          aria-label="Follow-up date and time (IST)"
          value={value.at ? toIstInputValue(value.at) : ""}
          min={toIstInputValue(new Date())}
          onChange={(e) => onChange({ key: "custom", at: e.target.value ? fromIstInputValue(e.target.value) : null })}
        />
      ) : null}
      {value.at ? <p className="text-[13px] text-fg-muted">Due {formatDue(value.at)} IST</p> : null}
    </div>
  );
}
