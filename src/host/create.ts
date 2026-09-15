import type { Host } from './types';
import { getBridge } from './electron/bridge';
import { ElectronHost } from './electron';
import { MockHost } from './mock';
import { plausibleCommand } from '../session/command';
import { applyRestoreOverride, loadSettings } from '../settings/storage';

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
  if (!saved) return new ElectronHost(bridge, info);

  // Rewrite captured commands into their resuming form before anything spawns.
  // `claude` would start a blank conversation, which makes restoring the tab
  // pointless; `claude --continue` picks up where it left off.
  const { restoreOverrides } = loadSettings();
  const sessions = saved.sessions.map((session) => ({
    ...session,
    tabs: Object.fromEntries(
      Object.entries(session.tabs).map(([id, tab]) => [
        id,
        {
          ...tab,
          // Guard on the way in as well as on the way out: a workspace written
          // by an earlier build can hold a command that was never typeable.
          command: applyRestoreOverride(plausibleCommand(tab.command), restoreOverrides),
        },
      ]),
    ),
  }));

  return new ElectronHost(bridge, info, { sessions, scrollback: saved.scrollback });
}
