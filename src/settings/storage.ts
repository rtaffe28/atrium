import { DEFAULT_SETTINGS, type Settings } from './types';

export const SETTINGS_KEY = 'atrium.settings.v1';

/**
 * Read settings outside React.
 *
 * Host creation needs them before any component exists — the restore overrides
 * have to be applied to the workspace before the driver spawns anything, or
 * the wrong command runs and re-running it is not free.
 */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      // Merged rather than replaced, so an object written by an older version
      // cannot drop a key the app now reads.
      notifyOn: { ...DEFAULT_SETTINGS.notifyOn, ...(parsed.notifyOn ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable; the session still works, it just will not persist.
  }
}

