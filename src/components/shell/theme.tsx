"use client";

import { useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.themePref = pref;
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>("system");

  useEffect(() => {
    const stored = (document.documentElement.dataset.themePref as ThemePref | undefined) ?? "system";
    setPref(stored);
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if ((document.documentElement.dataset.themePref ?? "system") === "system") apply("system");
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return {
    pref,
    setPref(next: ThemePref) {
      setPref(next);
      try {
        localStorage.setItem("theme", next);
      } catch {
        // ignore
      }
      apply(next);
    },
  };
}
