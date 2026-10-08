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
  /**
   * Show a desktop notification when a tab you are not looking at asks for
   * one. The program decides when to ask; this only decides whether the
   * request reaches the desktop. The tab is marked either way.
   */
  desktopNotifications: boolean;
  /** Play a tone when a tab you are not looking at rings the bell. */
  bellSound: boolean;
  /**
   * Notify when a tab you are not looking at stops working — its Working
   * tag goes out — unless its program just said so itself.
   */
  notifyWhenFinished: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  terminalFontSize: 13,
  defaultCommand: 'claude',
  desktopNotifications: true,
  bellSound: false,
  notifyWhenFinished: true,
};

export const FONT_SIZES = [11, 12, 13, 14, 16] as const;
