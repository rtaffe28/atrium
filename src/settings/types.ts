import type { AgentState } from '../session/types';

/**
 * User preferences.
 *
 * Deliberately *not* part of the Host interface. These are per-viewer UI
 * choices with no platform involvement, so they live in the renderer and
 * persist to localStorage. Pushing them through the host would buy nothing and
 * would mean two implementations of the same object.
 */
export interface Settings {
  /**
   * Alert tones. Off by default — a tone on every state change is the kind of
   * thing you want to opt into, not discover by being startled.
   */
  sounds: boolean;
  /** System notifications. On by default; still gated by OS permission. */
  notifications: boolean;
  /** Which agent states are worth interrupting for. */
  notifyOn: Record<Exclude<AgentState, 'working'>, boolean>;
  terminalFontSize: number;
  /**
   * Run this when a new session opens. Blank means just a shell.
   *
   * A session exists to run an agent, so the command is the interesting part
   * of creating one — and which agent you reach for is exactly the sort of
   * thing that differs per person.
   */
  defaultCommand: string;
  /**
   * Where a new session opens.
   *
   * This matters more than it looks. Opening every session in the home
   * directory makes an agent ask permission for your entire home folder, and
   * makes `--continue` resume whatever last ran there rather than the
   * conversation for the thing you are working on. A project directory is
   * trusted once and keeps its own history.
   */
  defaultCwd: string;
  /**
   * How a captured command is rewritten when a session is restored, one
   * `command = replacement` per line.
   *
   * Restoring is pointless if it hands you a blank agent, and only the agent
   * knows how to resume itself — so this is a mapping rather than anything the
   * app tries to be clever about.
   */
  restoreOverrides: string;
}

export const DEFAULT_SETTINGS: Settings = {
  sounds: false,
  notifications: true,
  notifyOn: { waiting: true, done: true, error: true },
  terminalFontSize: 13,
  defaultCommand: 'claude',
  defaultCwd: '~',
  restoreOverrides: 'claude = claude --continue',
};

export const FONT_SIZES = [11, 12, 13, 14, 16] as const;
