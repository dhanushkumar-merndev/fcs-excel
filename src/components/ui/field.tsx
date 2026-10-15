import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-xl border border-line bg-surface px-3.5 text-[15px] text-fg placeholder:text-fg-subtle transition-colors hover:border-line-strong focus-visible:border-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger sm:text-sm";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-11 sm:h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 resize-y py-2.5 leading-relaxed", className)} {...props} />;
}

export function Select({ className, children, wrapperClassName, ...props }: ComponentProps<"select"> & { wrapperClassName?: string }) {
  return (
    <div className={cn("relative", wrapperClassName)}>
      <select className={cn(control, "h-11 cursor-pointer appearance-none pr-9 sm:h-10", className)} {...props}>
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-subtle" />
    </div>
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-[13px] font-medium text-fg", className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-fg-subtle"> *</span> : null}
      </Label>
      {children}
      {error ? (
        <p role="alert" id={htmlFor ? `${htmlFor}-error` : undefined} className="text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[13px] text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      className={cn("size-4 cursor-pointer rounded border-line-strong accent-[var(--fg)]", className)}
      {...props}
    />
  );
}
