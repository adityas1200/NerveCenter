import { useEffect, useState } from "react";

const THEME_KEY = "nc-theme";
/** What the person picked. `system` follows the operating system and changes with it. */
export type Theme = "light" | "dark" | "system";

function readThemePreference(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "dark" || stored === "system" ? stored : "light";
  } catch {
    return "light";
  }
}

const systemDark = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches);

/** Owns the light/dark preference. Call once in the shell; pass the result down. */
export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(readThemePreference);
  useEffect(() => {
    const apply = () => { document.documentElement.dataset.theme = theme === "system" ? (systemDark() ? "dark" : "light") : theme; };
    apply();
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* keep the selection for this session only */
    }
    if (theme !== "system") return;
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    query?.addEventListener?.("change", apply);
    return () => query?.removeEventListener?.("change", apply);
  }, [theme]);
  return [theme, setTheme];
}
