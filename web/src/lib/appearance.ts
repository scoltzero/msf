import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

export type ThemeMode = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "msf-theme";

export const themeOptions: Array<{ id: ThemeMode; label: string; Icon: LucideIcon }> = [
  { id: "light", label: "明亮", Icon: Sun },
  { id: "dark", label: "暗黑", Icon: Moon },
  { id: "system", label: "跟随系统", Icon: Monitor },
];

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

export function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemeMode(stored) ? stored : "system";
}

export function prefersDarkMode() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(mode: ThemeMode) {
  if (typeof window === "undefined") return;
  const shouldUseDark = mode === "dark" || (mode === "system" && prefersDarkMode());
  document.documentElement.classList.toggle("dark", shouldUseDark);
  document.documentElement.classList.toggle("light", !shouldUseDark);
  window.localStorage.setItem(THEME_STORAGE_KEY, mode);
}

/**
 * Reconcile the server-side theme with the local cache. The server is the
 * source of truth once a value has been synced; a local choice that predates
 * server syncing (server still on the "system" default) wins once and is
 * pushed back so it is never lost again.
 */
export function reconcileTheme(backendValue: unknown, local: ThemeMode): { mode: ThemeMode; pushToServer: boolean } {
  const backend = isThemeMode(backendValue) ? backendValue : "system";
  if (backend !== "system") {
    return { mode: backend, pushToServer: backend !== local };
  }
  if (local !== "system") {
    return { mode: local, pushToServer: true };
  }
  return { mode: "system", pushToServer: false };
}
