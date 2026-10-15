"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Searches leads by name, phone, lead number or source ID. "/" focuses it. */
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const value = q.trim();
        router.push(value ? `/leads?q=${encodeURIComponent(value)}` : "/leads");
      }}
      className="relative max-w-md"
    >
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg-subtle" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        type="search"
        placeholder="Search leads by name, phone or lead number"
        aria-label="Search leads"
        className="h-10 w-full rounded-full border border-line bg-subtle pr-10 pl-10 text-sm text-fg placeholder:text-fg-subtle hover:border-line-strong focus-visible:border-fg-subtle focus-visible:bg-surface focus-visible:outline-none"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border border-line px-1.5 text-[11px] text-fg-subtle lg:block">
        /
      </kbd>
    </form>
  );
}
