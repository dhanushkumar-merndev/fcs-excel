"use client";

import { useCallback, useSyncExternalStore } from "react";

export type ThemePref = "light" | "dark" | "system";

const EVENT = "themechange";

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.themePref = pref;
}

function subscribe(onChange: () => void) {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystem = () => {
    if ((document.documentElement.dataset.themePref ?? "system") === "system") apply("system");
    onChange();
  };
  mql.addEventListener("change", onSystem);
  window.addEventListener(EVENT, onChange);
  return () => {
    mql.removeEventListener("change", onSystem);
    window.removeEventListener(EVENT, onChange);
  };
}

/** Theme preference stored by the no-flash script on <html data-theme-pref>. */
export function useTheme() {
  const pref = useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.themePref as ThemePref | undefined) ?? "system",
    () => "system" as ThemePref,
  );
  const setPref = useCallback((next: ThemePref) => {
    try {
      localStorage.setItem("theme", next);
    } catch {
      // ignore
    }
    apply(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { pref, setPref };
}
