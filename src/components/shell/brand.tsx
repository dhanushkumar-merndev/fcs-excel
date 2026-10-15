import { cn } from "@/lib/utils";

/** Original monogram: a plate with a steam line, drawn in currentColor. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8", className)}>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <path
        d="M9 19.5a7 7 0 0 0 14 0H9Z"
        className="fill-primary-fg"
      />
      <path d="M7.5 22.5h17" strokeWidth="1.8" strokeLinecap="round" className="stroke-primary-fg" />
      <path
        d="M16 8.5c-1.2 1.1-1.2 2.4 0 3.5s1.2 2.4 0 3.5"
        fill="none"
        strokeWidth="1.8"
        strokeLinecap="round"
        className="stroke-primary-fg"
      />
    </svg>
  );
}

export function BrandName({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <BrandMark className="size-7 shrink-0" />
      <span className="truncate text-[15px] font-semibold tracking-tight">{name}</span>
    </span>
  );
}
