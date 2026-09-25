import type { Platform } from './host/types';

/**
 * Whether a click asks for its link to open beside the current pane.
 *
 * Cmd on macOS, Ctrl everywhere else — the modifier every editor and terminal
 * already uses for "follow this link". Ctrl on a Mac is a right-click, so it
 * cannot stand in for Cmd there.
 */
export function isOpenLinkClick(
  event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>,
  platform: Platform,
): boolean {
  return platform === 'mac' ? event.metaKey : event.ctrlKey;
}
