import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import {
  PROXY_SETTINGS_KEY_V1,
  PROXY_SETTINGS_KEY_V2,
  readProxySettings,
  resetProxySettings,
  writeProxySettings,
} from "./settings";
import type { ProxyPageSettings } from "./types";

/**
 * Browser-persisted proxy-page settings.
 *
 * Persist inside the setter instead of waiting for a render effect. This makes
 * every switch/input durable as soon as the user changes it, and keeps rapid
 * consecutive updates based on the latest persisted value.
 */
export function useProxySettings() {
  const [settings, setSettingsState] = useState<ProxyPageSettings>(() => readProxySettings());
  const settingsRef = useRef(settings);

  const setSettings = useCallback((action: SetStateAction<ProxyPageSettings>) => {
    const candidate = typeof action === "function" ? action(settingsRef.current) : action;
    const persisted = writeProxySettings(candidate);
    settingsRef.current = persisted;
    setSettingsState(persisted);
  }, []);

  const resetSettings = useCallback(() => {
    const persisted = resetProxySettings();
    settingsRef.current = persisted;
    setSettingsState(persisted);
  }, []);

  useEffect(() => {
    const syncFromBrowserStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage) return;
      if (event.key !== null && event.key !== PROXY_SETTINGS_KEY_V2 && event.key !== PROXY_SETTINGS_KEY_V1) return;
      const persisted = readProxySettings();
      settingsRef.current = persisted;
      setSettingsState(persisted);
    };

    window.addEventListener("storage", syncFromBrowserStorage);
    return () => window.removeEventListener("storage", syncFromBrowserStorage);
  }, []);

  return { settings, setSettings, resetSettings };
}
