import { useEffect, useRef } from 'react';
import { useHost } from './host/context';
import type { Session } from './session/types';

/**
 * Mark a file tab you are not looking at when its file changes, the way a
 * terminal tab is marked for a bell, and for the same reason: an agent
 * rewriting the plan behind you is worth a glance, not an interruption.
 * Looking at the tab clears the mark, as it does for a bell.
 *
 * The watch lives as long as the tab does, not only while it is in front;
 * the view's own watch, which reloads the text, is only there while it is.
 */
export function useFileChangeMarks(sessions: Session[], focusedTabId: string | null): void {
  const host = useHost();
  const focused = useRef(focusedTabId);
  useEffect(() => {
    focused.current = focusedTabId;
  });

  // Which file tabs exist and where, as one string, so the watches are
  // redone only when that set changes and not on every store update.
  const key = sessions
    .flatMap((session) =>
      Object.values(session.tabs)
        .filter((tab) => tab.kind === 'file' && tab.path)
        .map((tab) => `${session.id}\t${tab.id}\t${tab.path}`),
    )
    .sort()
    .join('\n');

  useEffect(() => {
    if (!host.capabilities.files || !key) return;
    const stops = key.split('\n').map((entry) => {
      const [sessionId, tabId, path] = entry.split('\t');
      return host.files.watch(path, (event) => {
        if (event.type !== 'changed' || focused.current === tabId) return;
        host.sessions.patchTab(sessionId, tabId, { attention: true });
      });
    });
    return () => stops.forEach((stop) => stop());
  }, [host, key]);
}
