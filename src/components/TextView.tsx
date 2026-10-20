import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useHost } from '../host/context';
import type { FileContents } from '../host/types';

interface Props {
  path: string;
  /** A line to land on and mark, once the text is there. */
  line?: number;
}

interface State {
  contents: FileContents | null;
  /** The read failed: nothing there, or nothing readable. */
  missing: boolean;
  /** It was there, and then the watch said it was gone. */
  gone: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The floor: a file as plain text, live.
 *
 * In-tree rather than a widget on purpose. It is what shows when the widget
 * runner cannot build or load a viewer, and the thing that cannot fail must
 * not depend on the thing that can. See docs/plan/active/15-file-viewer.md.
 */
export function TextView({ path, line }: Props) {
  const host = useHost();
  // Keyed on the path by FileView, so another file is another TextView.
  const [state, setState] = useState<State>({ contents: null, missing: false, gone: false });
  const scroller = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      host.files.read(path).then(
        (contents) => {
          if (!cancelled) setState({ contents, missing: false, gone: false });
        },
        () => {
          // What was read stays on screen if there was something: the agent
          // may be about to write the file back.
          if (!cancelled) setState((s) => ({ ...s, missing: s.contents === null, gone: s.contents !== null }));
        },
      );
    void load();
    const stop = host.files.watch(path, (event) => {
      if (event.type === 'deleted') setState((s) => ({ ...s, gone: true }));
      else void load();
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [host, path]);

  // The reader's place survives a rewrite.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scrollTop.current;
  }, [state.contents]);

  // Land on the line asked for, once there is text to land on.
  useEffect(() => {
    if (line === undefined || !scroller.current) return;
    const row = scroller.current.querySelector<HTMLElement>(`[data-line="${line}"]`);
    row?.scrollIntoView?.({ block: 'center' });
  }, [line, state.contents]);

  const { contents, missing, gone } = state;
  if (missing) {
    return (
      <div className="empty">
        <p>No such file.</p>
        <span className="empty-hint">{path}</span>
      </div>
    );
  }
  if (!contents) return <div className="text-view" />;
  if (contents.kind === 'binary') {
    return (
      <div className="empty">
        <p>A binary file, {formatSize(contents.size)}.</p>
        <span className="empty-hint">Open it externally to see it.</span>
      </div>
    );
  }
  if (contents.kind === 'dataUrl') {
    return (
      <div className="empty">
        <img src={contents.dataUrl} alt={path} />
      </div>
    );
  }

  const lines = contents.text.split('\n');
  // A trailing newline ends the last line; it is not an empty line after it.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();

  return (
    <>
      {gone && (
        <div className="file-notice" role="status">
          Deleted. Still showing what it said, in case it comes back.
        </div>
      )}
      {contents.truncated && (
        <div className="file-notice" role="status">
          The first {formatSize(contents.text.length)} of {formatSize(contents.size)}.
        </div>
      )}
      <div
        className="text-view"
        ref={scroller}
        tabIndex={0}
        onScroll={(event) => {
          scrollTop.current = event.currentTarget.scrollTop;
        }}
      >
        {lines.map((text, i) => (
          <div key={i} className={`text-line${i + 1 === line ? ' is-marked' : ''}`} data-line={i + 1}>
            <span className="text-gutter" aria-hidden>
              {i + 1}
            </span>
            <span className="text-code">{text}</span>
          </div>
        ))}
      </div>
    </>
  );
}
