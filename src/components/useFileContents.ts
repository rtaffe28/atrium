import { useEffect, useState } from 'react';
import { useHost } from '../host/context';
import type { FileContents } from '../host/types';

export interface FileState {
  contents: FileContents | null;
  /** The read failed: nothing there, or nothing readable. */
  missing: boolean;
  /** It was there, and then the watch said it was gone. */
  gone: boolean;
}

const NOTHING: FileState = { contents: null, missing: false, gone: false };

/**
 * A file's contents, kept current.
 *
 * Read once, then again whenever the host says the file changed. A file that
 * goes missing after it was read keeps what was read, marked `gone`: the
 * agent may be about to write it back.
 */
export function useFileContents(
  path: string | undefined,
  as: 'text' | 'dataUrl' = 'text',
): FileState {
  const host = useHost();
  // The path and mode are kept with the result, so a result for another file
  // is never shown for this one while its own read is in flight.
  const [state, setState] = useState<FileState & { path?: string; as?: string }>(NOTHING);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const load = () =>
      host.files.read(path, as).then(
        (contents) => {
          if (!cancelled) setState({ path, as, contents, missing: false, gone: false });
        },
        () => {
          if (cancelled) return;
          setState((s) =>
            s.path === path && s.as === as && s.contents
              ? { ...s, gone: true }
              : { path, as, contents: null, missing: true, gone: false },
          );
        },
      );
    void load();
    const stop = host.files.watch(path, (event) => {
      if (event.type === 'deleted') setState((s) => (s.path === path ? { ...s, gone: true } : s));
      else void load();
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [host, path, as]);

  if (!path || state.path !== path || state.as !== as) return NOTHING;
  return state;
}
