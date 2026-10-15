"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Debounced search that writes to the URL; Enter searches immediately. */
export function SearchInput({ defaultValue, onSearch }: { defaultValue: string; onSearch: (q: string) => void }) {
  const [value, setValue] = useState(defaultValue);
  const timer = useRef<number | undefined>(undefined);
  const last = useRef(defaultValue);

  useEffect(() => {
    setValue(defaultValue);
    last.current = defaultValue;
  }, [defaultValue]);

  function submit(next: string) {
    window.clearTimeout(timer.current);
    const q = next.trim();
    if (q === last.current) return;
    last.current = q;
    onSearch(q);
  }

  return (
    <form
      role="search"
      className="relative min-w-0 flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
    >
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg-subtle" />
      <input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        aria-label="Search leads"
        placeholder="Name, phone, lead # or campaign"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => submit(next), 400);
        }}
        className="h-11 w-full rounded-xl border border-line bg-surface pr-10 pl-10 text-[15px] placeholder:text-fg-subtle hover:border-line-strong focus-visible:border-fg-subtle focus-visible:outline-none sm:h-10 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setValue("");
            submit("");
          }}
          className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-fg-subtle hover:bg-hover hover:text-fg"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </form>
  );
}
