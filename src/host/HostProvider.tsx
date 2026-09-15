import type { ReactNode } from 'react';
import { HostCtx } from './context';
import type { Host } from './types';

export function HostProvider({ host, children }: { host: Host; children: ReactNode }) {
  return <HostCtx.Provider value={host}>{children}</HostCtx.Provider>;
}
