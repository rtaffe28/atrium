import type { Host } from './types';
import { getBridge } from './electron/bridge';
import { ElectronHost } from './electron';
import { MockHost } from './mock';

/**
 * Pick a host for this runtime.
 *
 * The preload bridge is only present inside the Electron shell, so its absence
 * is the signal — no user-agent sniffing, no build-time flag. Both branches
 * return the same interface, which is the whole point.
 */
export async function createHost(): Promise<Host> {
  const bridge = getBridge();
  if (!bridge) return new MockHost();

  const info = await bridge.info();
  // Loaded before the driver exists: hydrating afterwards would mean spawning
  // a seed terminal and immediately throwing it away.
  const saved = await bridge.workspace.load().catch(() => null);
  return new ElectronHost(
    bridge,
    info,
    saved ? { sessions: saved.sessions, scrollback: saved.scrollback } : undefined,
  );
}
