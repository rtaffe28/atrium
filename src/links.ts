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

/**
 * What an address-bar entry means as a URL, or null for nothing at all.
 *
 * Anything without a scheme gets http://, so `localhost:5173` goes where you
 * meant. VS Code's address bar falls back to a web search; a pane beside an
 * agent is for the server it just started, so there is no search here.
 */
export function toUrl(entry: string): string | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  // A scheme is a word and a colon — unless what follows the colon is a port
  // number, or nothing: localhost:5173 and example.com:8080/x are hosts.
  return /^[a-z][a-z0-9+.-]*:(?!\d|$)/i.test(trimmed) ? trimmed : `http://${trimmed}`;
}
