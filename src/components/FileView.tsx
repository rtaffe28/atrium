import { useEffect, useRef, useState } from 'react';
import { claimFocus, type FocusRequest } from '../focusRequest';
import { useCapability, useHost } from '../host/context';
import { basename, dirname, isUnder, relativeTo } from '../paths';
import type { FileTarget, Session, SessionDriver, Tab } from '../session/types';
import { languageFor, viewerFor } from '../viewers/kind';
import { CodeView } from './CodeView';
import { FolderTree } from './FolderTree';
import { Icon } from './Icon';
import { ImageView } from './ImageView';
import { MarkdownView } from './MarkdownView';
import { useFileContents } from './useFileContents';

interface Props {
  tab: Tab;
  session: Session;
  driver: SessionDriver;
  focusRequest?: FocusRequest | null;
  /** A Cmd- or Ctrl-click asked for a file or folder beside this pane. */
  onOpenBeside: (target: FileTarget) => void;
  /** A link to the web in the file was clicked. */
  onOpenLink: (url: string) => void;
}

const ICON = {
  tree: 'M2 3h12v10H2zM6 3v10',
  source: 'M10 4l4 4-4 4M6 4 2 8l4 4',
  folder: 'M1.5 4.5h4l1.5 1.5h7.5v7h-13z',
  external:
    'M12 8.67v4a1.33 1.33 0 0 1-1.33 1.33H3.33A1.33 1.33 0 0 1 2 12.67V5.33A1.33 1.33 0 0 1 3.33 4h4M10 2h4v4M6.67 9.33 14 2',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Where a tree goes for a file that has none: the directory the file was
 * opened from, if the file is in it, otherwise the file's own.
 */
function treeRootFor(path: string | undefined, cwd: string): string {
  if (!path) return cwd;
  if (isUnder(cwd, path)) return cwd;
  return dirname(path) ?? path;
}

/**
 * A file tab: the frame, with the folder tree on one side and the file on
 * the other, shown by whichever viewer its type calls for. The frame is the
 * app's; the viewers are in-tree today, and widgets once the runner in
 * 14-composable-rail.md exists — see 15-file-viewer.md.
 */
export function FileView({ tab, session, driver, focusRequest, onOpenBeside, onOpenLink }: Props) {
  const host = useHost();
  const canRead = useCapability('files');
  const [treeShown, setTreeShown] = useState(true);
  const [sourceShown, setSourceShown] = useState(false);
  const frame = useRef<HTMLDivElement>(null);

  const kind = tab.path ? viewerFor(tab.path) : null;
  const file = useFileContents(canRead ? tab.path : undefined, kind === 'image' ? 'dataUrl' : 'text');

  // The tree if there is one, else the text: whichever the keys should work in.
  useEffect(() => {
    if (!claimFocus(focusRequest ?? null, tab.id)) return;
    frame.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, [focusRequest, tab.id]);

  // A folder with a README is a folder that explains itself: it is shown first.
  useEffect(() => {
    if (!canRead || !tab.root || tab.path) return;
    let cancelled = false;
    host.files.list(tab.root).then(
      (entries) => {
        if (cancelled) return;
        const readme = entries.find((entry) => !entry.directory && /^readme(\.|$)/i.test(entry.name));
        if (readme) driver.showFile(session.id, tab.id, readme.path);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [host, driver, session.id, tab.id, tab.root, tab.path, canRead]);

  if (!canRead) return <div className="empty">This host cannot read files.</div>;

  const patch = (fields: Partial<Tab>) => driver.patchTab(session.id, tab.id, fields);
  const hasTree = Boolean(tab.root) && treeShown;

  const toggleTree = () => {
    if (tab.root) setTreeShown((shown) => !shown);
    else patch({ root: treeRootFor(tab.path, tab.cwd ?? session.cwd) });
  };
  const openFolder = async () => {
    const dir = await host.files.chooseDirectory();
    if (!dir) return;
    patch({ root: dir });
    setTreeShown(true);
  };
  const openExternally = () => {
    const path = tab.path ?? tab.root;
    if (path) void host.files.openExternally(path);
  };
  const show = (path: string) => driver.showFile(session.id, tab.id, path);

  const shown = tab.path ?? tab.root;
  const where = shown ? relativeTo(session.cwd, shown) : '';
  const name = shown ? basename(shown) : '';
  const folder = where.endsWith(name) ? where.slice(0, where.length - name.length) : '';

  const button = (label: string, icon: string, onClick: () => void, on = false, disabled = false) => (
    <button
      type="button"
      className={`icon-button subtle${on ? ' is-on' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={on || undefined}
    >
      <Icon d={icon} />
    </button>
  );

  const body = () => {
    if (!tab.path) {
      return <div className="empty">{tab.root ? 'Choose a file from the tree.' : 'Nothing to show.'}</div>;
    }
    if (file.missing) {
      return (
        <div className="empty">
          <p>No such file.</p>
          <span className="empty-hint">{tab.path}</span>
        </div>
      );
    }
    const { contents } = file;
    if (!contents) return <div className="code-view" />;
    if (contents.kind === 'binary') {
      return (
        <div className="empty">
          <p>A binary file, {formatSize(contents.size)}.</p>
          <span className="empty-hint">Open it externally to see it.</span>
        </div>
      );
    }
    if (contents.kind === 'dataUrl') {
      return <ImageView key={tab.path} path={tab.path} dataUrl={contents.dataUrl} size={contents.size} />;
    }
    if (kind === 'markdown' && !sourceShown) {
      return (
        <MarkdownView
          key={tab.path}
          path={tab.path}
          text={contents.text}
          onShow={show}
          onOpenBeside={onOpenBeside}
          onOpenLink={onOpenLink}
        />
      );
    }
    return (
      <CodeView
        key={tab.path}
        text={contents.text}
        language={languageFor(tab.path, contents.text.slice(0, 200))}
        line={tab.line}
      />
    );
  };

  return (
    <div className="fileview" ref={frame}>
      {hasTree && tab.root && (
        <FolderTree
          // A new root is a new tree: nothing expanded under the old one carries over.
          key={tab.root}
          root={tab.root}
          selected={tab.path}
          onReroot={(root) => patch({ root })}
          onShow={show}
          onOpenBeside={onOpenBeside}
        />
      )}
      <div className="fileview-main">
        <div className="file-bar">
          {button('Folder tree', ICON.tree, toggleTree, hasTree)}
          {kind === 'markdown' && button('Source', ICON.source, () => setSourceShown((s) => !s), sourceShown)}
          <span className="file-path" title={shown}>
            <span className="file-folder">{folder}</span>
            <strong>{name}</strong>
          </span>
          {button('Open folder…', ICON.folder, () => void openFolder())}
          {button('Open externally', ICON.external, openExternally, false, !shown)}
        </div>
        {file.gone && (
          <div className="file-notice" role="status">
            Deleted. Still showing what it said, in case it comes back.
          </div>
        )}
        {file.contents?.kind === 'text' && file.contents.truncated && (
          <div className="file-notice" role="status">
            The first {formatSize(file.contents.text.length)} of {formatSize(file.contents.size)}.
          </div>
        )}
        {body()}
      </div>
    </div>
  );
}
