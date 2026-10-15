import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <>
      <LoaderCircle aria-hidden className={cn("size-4 animate-spin motion-reduce:animate-none", className)} />
      {label ? <span className="sr-only">{label}</span> : null}
    </>
  );
}
