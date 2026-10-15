import type { ComponentProps } from "react";
import type { Tint } from "@/lib/domain/stages";
import { cn } from "@/lib/utils";

const tints: Record<Tint, string> = {
  gray: "bg-tint-gray text-tint-gray-fg",
  blue: "bg-tint-blue text-tint-blue-fg",
  teal: "bg-tint-teal text-tint-teal-fg",
  violet: "bg-tint-violet text-tint-violet-fg",
  amber: "bg-tint-amber text-tint-amber-fg",
  orange: "bg-tint-orange text-tint-orange-fg",
  green: "bg-tint-green text-tint-green-fg",
  red: "bg-tint-red text-tint-red-fg",
};

export function Badge({
  tint = "gray",
  className,
  dot,
  ...props
}: ComponentProps<"span"> & { tint?: Tint; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium",
        tints[tint],
        className,
      )}
      {...props}
    >
      {dot ? <span aria-hidden className="size-1.5 rounded-full bg-current opacity-80" /> : null}
      {props.children}
    </span>
  );
}
