import { useCallback, useEffect, useRef, useState } from 'react';
import { useCapability, useHost } from '../host/context';
import type { GitStatus } from '../host/types';

/** How often a changes tab asks git again while the window has focus. */
export const STATUS_POLL_MS = 2000;

export interface GitStatusState {
  /** Undefined until the first answer; null when `dir` is not in a repository. */
  status: GitStatus | null | undefined;
  refresh: () => void;
}

/**
 * What git says changed in the repository holding `dir`, kept current.
 *
 * Polled rather than watched: an agent's edits land anywhere in the tree, and
 * a recursive watch on a repository with a node_modules in it costs more than
 * asking git every couple of seconds. Only while the window has focus — the
 * edits made while you were away are picked up the moment you come back.
 * An answer that says what the last one said changes nothing, so a tab
 * reading a diff is not re-rendered every two seconds for no reason.
 */
export function useGitStatus(dir: string | undefined): GitStatusState {
  const host = useHost();
  const canAsk = useCapability('git');
  // Kept with the directory it is about, so a new directory reads as not yet
  // answered without an effect having to clear it.
  const [answer, setAnswer] = useState<{ dir: string; status: GitStatus | null } | null>(null);
  const last = useRef('');
  const asking = useRef(false);
  /** Bumped when `dir` changes, so an answer about the old one is dropped. */
  const generation = useRef(0);

  const refresh = useCallback(() => {
    if (!dir || !canAsk || asking.current) return;
    asking.current = true;
    const asked = generation.current;
    host.git.status(dir).then(
      (next) => {
        asking.current = false;
        if (asked !== generation.current) return;
        const key = JSON.stringify(next);
        if (key === last.current) return;
        last.current = key;
        setAnswer({ dir, status: next });
      },
      () => {
        asking.current = false;
        if (asked === generation.current) setAnswer((was) => (was?.dir === dir ? was : { dir, status: null }));
      },
    );
  }, [host, dir, canAsk]);

  useEffect(() => {
    generation.current++;
    asking.current = false;
    last.current = '';
    refresh();
    const timer = window.setInterval(() => {
      if (document.hasFocus()) refresh();
    }, STATUS_POLL_MS);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  return { status: answer && answer.dir === dir ? answer.status : undefined, refresh };
}
