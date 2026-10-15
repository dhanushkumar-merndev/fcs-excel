"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

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

/**
 * Runs `onOpen` when `open` flips to true, during render (React's recommended way to reset
 * state from a prop change — no effect, no extra paint with stale values).
 */
export function useOnOpen(open: boolean, onOpen: () => void) {
  const [prev, setPrev] = useState(open);
  if (open !== prev) {
    setPrev(open);
    if (open) onOpen();
  }
}

/** Re-syncs local state from a prop when the prop changes (render-phase, no effect). */
export function useSyncedState<T>(source: T) {
  const [value, setValue] = useState(source);
  const [prev, setPrev] = useState(source);
  if (!Object.is(prev, source)) {
    setPrev(source);
    setValue(source);
  }
  return [value, setValue] as const;
}

function readStorage(key: string | null) {
  if (!key || typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

/** A string draft persisted to localStorage until explicitly cleared (e.g. after a successful save). */
export function usePersistentDraft(key: string | null) {
  const [state, setState] = useState(() => ({ key, value: readStorage(key) }));
  if (state.key !== key) setState({ key, value: readStorage(key) });

  const update = useCallback(
    (next: string) => {
      setState({ key, value: next });
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
  return [state.key === key ? state.value : readStorage(key), update, clear] as const;
}

/** Stable per-submission idempotency key; call `rotate()` after a successful save. */
export function useRequestId() {
  const [id, setId] = useState(() => crypto.randomUUID());
  const rotate = useCallback(() => setId(crypto.randomUUID()), []);
  return [id, rotate] as const;
}

const storageEvent = (key: string) => `local-storage:${key}`;

/** JSON value in localStorage, hydration-safe (server and first render use `initial`). */
export function useLocalStorageState<T>(key: string, initial: T) {
  const [initialValue] = useState(initial);
  const raw = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("storage", onChange);
      window.addEventListener(storageEvent(key), onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(storageEvent(key), onChange);
      };
    },
    () => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const value = useMemo(() => {
    if (raw === null) return initialValue;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return initialValue;
    }
  }, [raw, initialValue]);
  const update = useCallback(
    (next: T) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // ignore
      }
      window.dispatchEvent(new Event(storageEvent(key)));
    },
    [key],
  );
  return [value, update] as const;
}
