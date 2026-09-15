import type { PersistedWorkspace, WorkspaceDriver } from '../types';

const KEY = 'atrium.workspace.v1';

/**
 * Workspace persistence in localStorage.
 *
 * The budget is deliberately small: localStorage is a few megabytes for the
 * whole origin, and losing the entire workspace because one chatty agent
 * filled the quota would be a poor trade for a longer scrollback.
 */
export class LocalStorageWorkspace implements WorkspaceDriver {
  readonly scrollbackBudget = 32_000;

  async load(): Promise<PersistedWorkspace | null> {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as PersistedWorkspace) : null;
    } catch {
      return null;
    }
  }

  async save(state: PersistedWorkspace): Promise<void> {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Quota exceeded or storage blocked. Dropping the save is correct —
      // the session keeps working, it just will not be restored.
    }
  }
}
