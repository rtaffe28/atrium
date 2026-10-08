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
    const parsed = JSON.parse(raw) as Partial<Settings> & Record<string, unknown>;
    // Written by a version that inferred session state and alerted on it.
    // Alerts now come from the programs themselves, under new keys.
    delete parsed.sounds;
    delete parsed.notifications;
    delete parsed.notifyOn;
    return { ...DEFAULT_SETTINGS, ...parsed };
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

