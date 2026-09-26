/**
 * Splitter drags, as terminals need to hear about them.
 *
 * A terminal refits by resizing its pty, and every resize is a SIGWINCH the
 * program in it redraws for. Doing that on each frame of a drag has an agent
 * repaint its whole screen dozens of times a second, so terminals sit still
 * while a splitter moves and refit once, together, when it is let go.
 */
const SETTLED = 'atrium:layout-settled';

export function isResizing(): boolean {
  return document.body.classList.contains('is-resizing');
}

export function announceSettled(): void {
  window.dispatchEvent(new Event(SETTLED));
}

export function onSettled(handler: () => void): () => void {
  window.addEventListener(SETTLED, handler);
  return () => window.removeEventListener(SETTLED, handler);
}
