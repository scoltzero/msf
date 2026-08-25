import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "@/App";
import { AuthProvider } from "@/lib/auth";
import { LanguageProvider } from "@/lib/localization";
import {
  CONTENT_PLATE_SETTINGS_STORAGE_KEY,
  DEFAULT_CONTENT_PLATE_OPACITY,
  LEGACY_CONTENT_PLATE_OPACITY_STORAGE_KEY,
  applyContentPlateOpacityCss,
  migrateLegacyContentPlateOpacity,
  parseStoredContentPlateOpacity,
  type ContentPlateOpacity,
} from "@/lib/content-plate-opacity";
import "@/app/globals.css";

const root = document.documentElement;
const savedLanguage = localStorage.getItem("msf-language");
root.lang = savedLanguage === "en-US" || savedLanguage === "en" ? "en-US" : "zh-CN";
const savedTheme = localStorage.getItem("msf-theme");
const useDarkTheme = savedTheme === "dark" || (savedTheme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
root.classList.toggle("dark", useDarkTheme);
root.classList.toggle("light", !useDarkTheme);
const savedScene = localStorage.getItem("msf-glass-scene");
const savedQuality = localStorage.getItem("msf-glass-quality");
root.dataset.garyScene = savedScene === "static" || savedScene === "neutral" ? savedScene : "neutral";
root.dataset.garyQuality = savedQuality === "balanced" || savedQuality === "reduced" ? savedQuality : "full";

function readInitialContentPlateOpacity(): ContentPlateOpacity {
  try {
    const cached = parseStoredContentPlateOpacity(localStorage.getItem(CONTENT_PLATE_SETTINGS_STORAGE_KEY));
    if (cached) return cached;

    const migrated = migrateLegacyContentPlateOpacity(localStorage.getItem(LEGACY_CONTENT_PLATE_OPACITY_STORAGE_KEY));
    const initial = migrated || DEFAULT_CONTENT_PLATE_OPACITY;
    // A migrated value is written once so subsequent loads never depend on the
    // legacy key. Defaults are cached as well to make the first paint stable.
    localStorage.setItem(CONTENT_PLATE_SETTINGS_STORAGE_KEY, JSON.stringify(initial));
    return initial;
  } catch {
    return DEFAULT_CONTENT_PLATE_OPACITY;
  }
}

// Restore plate opacity before React mounts, avoiding a visible first-paint
// transition while the settings page is still loading from the API.
applyContentPlateOpacityCss(readInitialContentPlateOpacity(), root);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <LanguageProvider>
          <App />
        </LanguageProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
