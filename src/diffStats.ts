import { useEffect } from 'react';
import { useHost } from './host/context';
import type { Session } from './session/types';

/** How often the rail's +/− is brought up to date. Slower than an open changes tab. */
export const DIFF_STAT_POLL_MS = 5000;

/**
 * Keep each session's +/− on the rail true to what git says changed in its
 * directory.
 *
 * Asked one session at a time, so a dozen sessions are a dozen quick git
 * runs in a row rather than at once, and only while the window has focus:
 * the rail is not being read otherwise, and coming back asks at once. A
 * session outside a repository keeps what it has.
 */
export function useDiffStats(sessions: Session[], windowFocused: boolean): void {
  const host = useHost();
  // The directories to ask about, as one string, so the loop is restarted
  // only when sessions come, go or move, not on every store update.
  const key = sessions.map((session) => `${session.id}\t${session.cwd}`).join('\n');

  useEffect(() => {
    if (!host.capabilities.git || !windowFocused || !key) return;
    let stopped = false;
    let timer: number | undefined;
    const targets = key.split('\n').map((entry) => entry.split('\t') as [string, string]);

    const round = async () => {
      // Sessions in one directory are one question.
      const asked = new Map<string, ReturnType<typeof host.git.status>>();
      for (const [sessionId, cwd] of targets) {
        if (stopped) return;
        if (!asked.has(cwd)) asked.set(cwd, host.git.status(cwd).catch(() => null));
        const status = await asked.get(cwd);
        if (stopped || !status) continue;
        let added = 0;
        let removed = 0;
        for (const change of status.changes) {
          added += change.added;
          removed += change.removed;
        }
        host.sessions.setDiffStat(sessionId, { files: status.changes.length, added, removed });
      }
      if (!stopped) timer = window.setTimeout(() => void round(), DIFF_STAT_POLL_MS);
    };
    void round();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [host, key, windowFocused]);
}
