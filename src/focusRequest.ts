/**
 * A one-shot request to put the cursor somewhere.
 *
 * Deliberately mutable. The alternative — clearing the request from an effect
 * once a child has acted on it — means a state update per focus, and leaving
 * it set instead means any later remount silently honours it again and the
 * cursor jumps during a split or a tab move.
 *
 * A token that records its own consumption is both: it survives being read by
 * the one terminal that should act, and is inert to everything after.
 */
export interface FocusRequest {
  tabId: string;
  done: boolean;
}

export const requestFocus = (tabId: string): FocusRequest => ({ tabId, done: false });

/** True exactly once, for the tab the request names. */
export function claimFocus(request: FocusRequest | null, tabId: string): boolean {
  if (!request || request.done || request.tabId !== tabId) return false;
  request.done = true;
  return true;
}
