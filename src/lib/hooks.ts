"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export function useMediaQuery(query: string, serverValue = false) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

export const useIsMobile = () => useMediaQuery("(max-width: 767px)");

/** A string draft persisted to localStorage until explicitly cleared (e.g. after a successful save). */
export function usePersistentDraft(key: string | null) {
  const [value, setValue] = useState("");
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!key || loadedKey.current === key) return;
    loadedKey.current = key;
    try {
      setValue(window.localStorage.getItem(key) ?? "");
    } catch {
      setValue("");
    }
  }, [key]);

  const update = useCallback(
    (next: string) => {
      setValue(next);
      if (!key) return;
      try {
        if (next) window.localStorage.setItem(key, next);
        else window.localStorage.removeItem(key);
      } catch {
        // Storage unavailable (private mode): keep the in-memory draft.
      }
    },
    [key],
  );

  const clear = useCallback(() => update(""), [update]);
  return [value, update, clear] as const;
}

/** Stable per-submission idempotency key; call `rotate()` after a successful save. */
export function useRequestId() {
  const [id, setId] = useState(() => crypto.randomUUID());
  const rotate = useCallback(() => setId(crypto.randomUUID()), []);
  return [id, rotate] as const;
}

export function useLocalStorageState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // ignore
    }
  }, [key]);
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // ignore
      }
    },
    [key],
  );
  return [value, update] as const;
}
