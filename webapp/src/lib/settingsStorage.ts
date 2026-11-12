import { DEFAULT_SETTINGS, type CoreSettings, type Settings } from "./types";

const STORAGE_KEY = "trackplotter.settings";
const CORE_OVERRIDES_KEY = "trackplotter.coreOverrides";

/** Loads the last-saved settings from localStorage, filling in any missing
 * field (a fresh install, or one added since the save) from the defaults.
 * Never throws - private browsing, a blocked/full store, or corrupt JSON
 * all just fall back to the defaults. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore - private browsing, quota, storage disabled, etc.
  }
}

/** Per-experiment FPS/ROI diameter/Min speed/Max ROI%/Color overrides (see
 * App.tsx's coreOverrides), keyed by experiment filename. Unlike the loaded
 * data itself, these survive a reload - re-loading the same folder (same
 * filenames) reattaches them automatically. Same fallback rules as
 * loadSettings: never throws, missing/corrupt just comes back empty. */
export function loadCoreOverrides(): Record<string, CoreSettings> {
  try {
    const raw = localStorage.getItem(CORE_OVERRIDES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveCoreOverrides(overrides: Record<string, CoreSettings>): void {
  try {
    localStorage.setItem(CORE_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch {
    // ignore - private browsing, quota, storage disabled, etc.
  }
}
