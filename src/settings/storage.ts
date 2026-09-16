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
    // Sessions are resumed by id now. Leaving the old default in place would
    // pass --continue explicitly, which the shim honours and which resumes
    // "most recent in this directory" rather than this tab's conversation.
    if (parsed.restoreOverrides?.trim() === 'claude = claude --continue') {
      parsed.restoreOverrides = '';
    }
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

/**
 * Rewrite a captured command into the form that resumes it.
 *
 * `claude` starts a fresh conversation; `claude --continue` picks up the last
 * one in that directory. Restoring a session is pointless if it hands you a
 * blank agent, so the mapping is applied on the way back in.
 */
export function applyRestoreOverride(command: string | undefined, rules: string): string | undefined {
  if (!command) return command;
  const base = command.trim().split(/\s+/)[0];

  for (const line of rules.split('\n')) {
    const [from, ...rest] = line.split('=');
    if (rest.length === 0) continue;
    if (from.trim() !== base) continue;
    const to = rest.join('=').trim();
    return to || undefined;
  }
  return command;
}
