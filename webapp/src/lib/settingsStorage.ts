import { DEFAULT_SETTINGS, type Settings } from "./types";

const STORAGE_KEY = "trackplotter.settings";

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
