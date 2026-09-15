import { createContext, useContext } from 'react';
import type { Capabilities, Host } from './types';

export const HostCtx = createContext<Host | null>(null);

export function useHost(): Host {
  const host = useContext(HostCtx);
  if (!host) throw new Error('useHost must be used inside <HostProvider>');
  return host;
}

/**
 * Read one capability.
 *
 * Preferred over touching host.capabilities directly, because it reads as a
 * question at the call site — `useCapability('files')` — which is the habit
 * that keeps the browser build working.
 */
export function useCapability<K extends keyof Capabilities>(key: K): Capabilities[K] {
  return useHost().capabilities[key];
}
