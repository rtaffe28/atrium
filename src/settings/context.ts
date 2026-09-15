import { createContext, useContext } from 'react';
import { DEFAULT_SETTINGS, type Settings } from './types';

export interface SettingsApi {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const SettingsCtx = createContext<SettingsApi>({
  settings: DEFAULT_SETTINGS,
  update: () => {},
  reset: () => {},
});

export function useSettings(): SettingsApi {
  return useContext(SettingsCtx);
}
