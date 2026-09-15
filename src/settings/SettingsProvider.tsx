import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { SettingsCtx, type SettingsApi } from './context';
import { DEFAULT_SETTINGS, type Settings } from './types';

const KEY = 'atrium.settings.v1';

/**
 * Reads are wrapped because localStorage throws in a private window and can
 * come back empty after a clear. Defaults must always be a working answer.
 */
function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      // Merged rather than replaced, so a stored object written by an older
      // version cannot drop a key that the app now reads.
      notifyOn: { ...DEFAULT_SETTINGS.notifyOn, ...(parsed.notifyOn ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function save(settings: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable; the session still works, it just will not persist.
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      save(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    save(DEFAULT_SETTINGS);
    setSettings(DEFAULT_SETTINGS);
  }, []);

  const api = useMemo<SettingsApi>(() => ({ settings, update, reset }), [settings, update, reset]);

  return <SettingsCtx.Provider value={api}>{children}</SettingsCtx.Provider>;
}
