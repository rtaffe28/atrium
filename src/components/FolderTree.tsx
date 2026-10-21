import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHost } from '../host/context';
import type { FileEntry } from '../host/types';
import { isOpenLinkClick } from '../links';
import { dirname, foldersBetween, isUnder, joinSplit, splitPath } from '../paths';
import type { FileTarget } from '../session/types';
import { Icon } from './Icon';

interface Props {
  root: string;
  /** The file shown beside the tree: revealed, and marked. */
  selected?: string;
  onReroot: (root: string) => void;
  /** A plain click on a file: show it in this tab. */
  onShow: (path: string) => void;
  /** A Cmd- or Ctrl-click: open it beside, as a link. */
  onOpenBeside: (target: FileTarget) => void;
}

/** A directory over this many entries shows this many and says how many more. */
const CAP = 2000;

type Listing = 'loading' | 'error' | { entries: FileEntry[]; more: number };

/** One line of the tree as drawn. */
type Row =
  | { kind: 'entry'; entry: FileEntry; depth: number; expanded: boolean }
  | { kind: 'note'; key: string; text: string; depth: number };

function flatten(dir: string, open: Record<string, Listing>, depth: number, out: Row[]): void {
  const listing = open[dir];
  if (listing === undefined) return;
  if (listing === 'loading') {
    out.push({ kind: 'note', key: `${dir}#loading`, text: 'Listing…', depth });
    return;
  }
  if (listing === 'error') {
    out.push({ kind: 'note', key: `${dir}#error`, text: 'Could not list this folder', depth });
    return;
  }
  for (const entry of listing.entries) {
    const expanded = entry.directory && entry.path in open;
    out.push({ kind: 'entry', entry, depth, expanded });
    if (expanded) flatten(entry.path, open, depth + 1, out);
  }
  if (listing.more > 0) {
    out.push({ kind: 'note', key: `${dir}#more`, text: `and ${listing.more} more`, depth });
  }
}

const UP = 'M8 13V3M3.5 7.5 8 3l4.5 4.5';

/**
 * A folder's tree, beside the file chosen from it.
 *
 * Frame, not body: in the app's own React tree rather than a widget, the
 * call 14-composable-rail.md makes for the session list, and for the same
 * reasons. It is navigation rather than content, it reads the host directly,
 * and it still works when the widget runner does not.
 *
 * Directories are listed when expanded, so opening a repository does not walk
 * it, and every expanded directory is watched, so an agent writing ten files
 * into docs/ is ten rows appearing.
 */
export function FolderTree({ root, selected, onReroot, onShow, onOpenBeside }: Props) {
  const host = useHost();
  const platform = host.window.platform();
  // Keyed on the root by FileView, so a re-root is a new tree with nothing
  // expanded under the old one carried over.
  const [open, setOpen] = useState<Record<string, Listing>>(() => ({ [root]: 'loading' }));
  const [cursor, setCursor] = useState<string | null>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });

  // A listing lands only if its directory is still wanted: one collapsed
  // while it loads, or left behind by a re-root, must not reappear.
  const list = useCallback(
    (dir: string) => {
      void host.files.list(dir).then(
        (entries) =>
          setOpen((o) =>
            dir in o
              ? { ...o, [dir]: { entries: entries.slice(0, CAP), more: Math.max(0, entries.length - CAP) } }
              : o,
          ),
        () => setOpen((o) => (dir in o ? { ...o, [dir]: 'error' } : o)),
      );
    },
    [host],
  );

  useEffect(() => list(root), [root, list]);

  // Every expanded directory is watched, and released when it is collapsed.
  const watched = Object.keys(open).sort().join('\n');
  useEffect(() => {
    if (!watched) return;
    const stops = watched.split('\n').map((dir) => host.files.watch(dir, () => list(dir)));
    return () => stops.forEach((stop) => stop());
  }, [host, list, watched]);

  // The open file is revealed: its folders expand, so a file opened from the
  // terminal or by the agent is found in context.
  useEffect(() => {
    if (!selected || !isUnder(root, selected)) return;
    const fresh = foldersBetween(root, selected).filter((dir) => !(dir in openRef.current));
    if (fresh.length > 0) {
      setOpen((o) => {
        const next = { ...o };
        for (const dir of fresh) if (!(dir in next)) next[dir] = 'loading';
        return next;
      });
      fresh.forEach(list);
    }
    setCursor(selected);
  }, [root, selected, list]);

  const toggle = (dir: string) => {
    if (dir in openRef.current) {
      // Collapsing a folder forgets everything under it, and their watches.
      setOpen((o) => {
        const next: Record<string, Listing> = {};
        for (const key of Object.keys(o)) if (!isUnder(dir, key)) next[key] = o[key];
        return next;
      });
    } else {
      setOpen((o) => ({ ...o, [dir]: 'loading' }));
      list(dir);
    }
  };

  const rows = useMemo(() => {
    const out: Row[] = [];
    flatten(root, open, 0, out);
    return out;
  }, [root, open]);

  // The keyboard moves a cursor over the entries, only while the tree has
  // focus; the terminal's rule in 10-keyboard.md is untouched.
  const entries = rows.filter((row): row is Extract<Row, { kind: 'entry' }> => row.kind === 'entry');
  const at = entries.findIndex((row) => row.entry.path === cursor);
  const move = (to: number) => {
    const row = entries[Math.max(0, Math.min(to, entries.length - 1))];
    if (row) setCursor(row.entry.path);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    const row = at >= 0 ? entries[at] : null;
    switch (event.key) {
      case 'ArrowDown':
        move(at < 0 ? 0 : at + 1);
        break;
      case 'ArrowUp':
        move(at < 0 ? 0 : at - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(entries.length - 1);
        break;
      case 'ArrowRight':
        if (!row) move(0);
        else if (row.entry.directory && !row.expanded) toggle(row.entry.path);
        else if (row.entry.directory) move(at + 1);
        break;
      case 'ArrowLeft': {
        if (!row) break;
        if (row.entry.directory && row.expanded) {
          toggle(row.entry.path);
          break;
        }
        const parent = dirname(row.entry.path);
        const up = entries.find((r) => r.entry.path === parent);
        if (up) setCursor(up.entry.path);
        break;
      }
      case 'Enter':
        if (!row) break;
        if (row.entry.directory) toggle(row.entry.path);
        else onShow(row.entry.path);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  useEffect(() => {
    if (!cursor || !rowsRef.current) return;
    for (const el of rowsRef.current.querySelectorAll<HTMLElement>('[data-path]')) {
      if (el.dataset.path === cursor) el.scrollIntoView?.({ block: 'nearest' });
    }
  }, [cursor, rows]);

  const { prefix, segments } = splitPath(root);
  const crumbs = [
    { label: prefix || '.', path: joinSplit({ prefix, segments: [] }) },
    ...segments.map((segment, i) => ({
      label: segment,
      path: joinSplit({ prefix, segments: segments.slice(0, i + 1) }),
    })),
  ];
  const parent = dirname(root);

  const click = (event: React.MouseEvent, entry: FileEntry) => {
    setCursor(entry.path);
    if (isOpenLinkClick(event, platform)) {
      onOpenBeside(entry.directory ? { kind: 'folder', root: entry.path } : { kind: 'file', path: entry.path });
    } else if (entry.directory) {
      toggle(entry.path);
    } else {
      onShow(entry.path);
    }
  };

  return (
    <div className="file-tree">
      <div className="tree-head">
        <button
          type="button"
          className="icon-button subtle"
          title="Up one folder"
          aria-label="Up one folder"
          disabled={parent === null}
          onClick={() => parent !== null && onReroot(parent)}
        >
          <Icon d={UP} />
        </button>
        {/* The root as a breadcrumb: a segment re-roots the tree there. */}
        <nav className="tree-crumbs" aria-label="Folder">
          {crumbs.map((crumb, i) => (
            <span key={crumb.path} className="tree-crumb-slot">
              {i > 1 && <span className="crumb-sep">/</span>}
              <button
                type="button"
                className={`tree-crumb${i === crumbs.length - 1 ? ' strong' : ''}`}
                title={crumb.path}
                onClick={() => onReroot(crumb.path)}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>
      </div>
      <div className="tree-rows" ref={rowsRef} role="tree" tabIndex={0} onKeyDown={onKeyDown} aria-label="Files">
        {rows.map((row) =>
          row.kind === 'note' ? (
            <div key={row.key} className="tree-note" style={{ '--depth': row.depth } as React.CSSProperties}>
              {row.text}
            </div>
          ) : (
            <div
              key={row.entry.path}
              role="treeitem"
              aria-expanded={row.entry.directory ? row.expanded : undefined}
              aria-selected={row.entry.path === selected}
              data-path={row.entry.path}
              className={`tree-row${row.entry.directory ? ' is-dir' : ''}${
                row.entry.path === selected ? ' is-selected' : ''
              }${row.entry.path === cursor ? ' is-cursor' : ''}`}
              style={{ '--depth': row.depth } as React.CSSProperties}
              onClick={(event) => click(event, row.entry)}
            >
              <span className="tree-chevron" aria-hidden>
                {row.entry.directory ? (row.expanded ? '▾' : '▸') : ''}
              </span>
              <span className="tree-name">{row.entry.name}</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
