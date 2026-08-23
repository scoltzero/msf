import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

export type ThemeMode = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "msf-theme";

export const themeOptions: Array<{ id: ThemeMode; label: string; Icon: LucideIcon }> = [
  { id: "light", label: "明亮", Icon: Sun },
  { id: "dark", label: "暗黑", Icon: Moon },
  { id: "system", label: "跟随系统", Icon: Monitor },
];

export function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
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
