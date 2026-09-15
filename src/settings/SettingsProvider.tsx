import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { SettingsCtx, type SettingsApi } from './context';
import { loadSettings, saveSettings } from './storage';
import { DEFAULT_SETTINGS, type Settings } from './types';

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    saveSettings(DEFAULT_SETTINGS);
    setSettings(DEFAULT_SETTINGS);
  }, []);

  const api = useMemo<SettingsApi>(() => ({ settings, update, reset }), [settings, update, reset]);

  return <SettingsCtx.Provider value={api}>{children}</SettingsCtx.Provider>;
}
