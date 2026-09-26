/**
 * User preferences.
 *
 * Deliberately *not* part of the Host interface. These are per-viewer UI
 * choices with no platform involvement, so they live in the renderer and
 * persist to localStorage. Pushing them through the host would buy nothing and
 * would mean two implementations of the same object.
 */
export interface Settings {
  terminalFontSize: number;
  /**
   * Run this when a new session opens. Blank means just a shell.
   *
   * A session exists to run an agent, so the command is the interesting part
   * of creating one — and which agent you reach for is exactly the sort of
   * thing that differs per person.
   */
  defaultCommand: string;
}

export const DEFAULT_SETTINGS: Settings = {
  terminalFontSize: 13,
  defaultCommand: 'claude',
};

export const FONT_SIZES = [11, 12, 13, 14, 16] as const;
