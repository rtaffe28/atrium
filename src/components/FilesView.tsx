import { useCallback, useEffect, useState } from 'react';
import { useHost } from '../host/context';
import type { FileEntry } from '../host/types';

interface Props {
  /** The session's working directory: the explorer is rooted where you work. */
  root: string;
}

/**
 * A file tree beside the file it is showing.
 *
 * Directories are listed lazily, on expand, so opening a repo does not walk it.
 * The tab keeps no state of its own: the root is the session's directory, and
 * which file you were reading is not worth persisting across a restart.
 */
export function FilesView({ root }: Props) {
  const host = useHost();
  const [expanded, setExpanded] = useState<Record<string, FileEntry[]>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [contents, setContents] = useState<{ text: string; truncated: boolean } | null>(null);

  const load = useCallback(
    async (path: string) => {
      const entries = await host.files.list(path).catch(() => []);
      setExpanded((current) => ({ ...current, [path]: entries }));
    },
    [host],
  );

  // Root listing is fetched directly rather than through `load`, so it can be
  // cancelled: changing directory mid-read would otherwise drop the old
  // listing into the new tree.
  useEffect(() => {
    let cancelled = false;
    host.files
      .list(root)
      .then((entries) => {
        if (!cancelled) setExpanded({ [root]: entries });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [host, root]);

  const toggle = (entry: FileEntry) => {
    if (!entry.directory) {
      setOpen(entry.path);
      void host.files.read(entry.path).then(setContents).catch(() => setContents(null));
      return;
    }
    setExpanded((current) => {
      if (entry.path in current) {
        const next = { ...current };
        delete next[entry.path];
        return next;
      }
      void load(entry.path);
      return current;
    });
  };

  const rows = (path: string, depth: number): React.ReactNode =>
    (expanded[path] ?? []).map((entry) => (
      <li key={entry.path}>
        <button
          className={`tree-row${open === entry.path ? ' is-open' : ''}`}
          style={{ paddingLeft: 8 + depth * 13 }}
          onClick={() => toggle(entry)}
        >
          <span className={`tree-mark ${entry.directory ? 'is-dir' : 'is-file'}`} aria-hidden>
            {entry.directory ? (entry.path in expanded ? '▾' : '▸') : ''}
          </span>
          <span className="tree-name">{entry.name}</span>
        </button>
        {entry.directory && entry.path in expanded && (
          <ul className="tree-children">{rows(entry.path, depth + 1)}</ul>
        )}
      </li>
    ));

  return (
    <div className="files">
      <nav className="files-tree">
        <p className="files-root" title={root}>
          {root}
        </p>
        <ul className="tree">{rows(root, 0)}</ul>
      </nav>

      <div className="files-view">
        {open ? (
          <>
            <p className="files-path">{open}</p>
            <pre className="files-code">
              <code>{contents?.text ?? ''}</code>
            </pre>
            {contents?.truncated && <p className="files-note">Truncated — file is large.</p>}
            {contents?.text === '' && <p className="files-note">Nothing to show for this file.</p>}
          </>
        ) : (
          <p className="files-note">Choose a file to read it.</p>
        )}
      </div>
    </div>
  );
}
