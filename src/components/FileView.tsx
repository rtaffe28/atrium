import { useEffect, useRef, useState } from 'react';
import { claimFocus, type FocusRequest } from '../focusRequest';
import { useCapability, useHost } from '../host/context';
import { basename, dirname, isUnder, relativeTo } from '../paths';
import type { FileTarget, Session, SessionDriver, Tab } from '../session/types';
import { FolderTree } from './FolderTree';
import { Icon } from './Icon';
import { TextView } from './TextView';

interface Props {
  tab: Tab;
  session: Session;
  driver: SessionDriver;
  focusRequest?: FocusRequest | null;
  /** A Cmd- or Ctrl-click asked for a file or folder beside this pane. */
  onOpenBeside: (target: FileTarget) => void;
}

const ICON = {
  tree: 'M2 3h12v10H2zM6 3v10',
  folder: 'M1.5 4.5h4l1.5 1.5h7.5v7h-13z',
  external:
    'M12 8.67v4a1.33 1.33 0 0 1-1.33 1.33H3.33A1.33 1.33 0 0 1 2 12.67V5.33A1.33 1.33 0 0 1 3.33 4h4M10 2h4v4M6.67 9.33 14 2',
};

/**
 * Where a tree goes for a file that has none: the session's directory, if
 * the file is in it, otherwise the file's own.
 */
function treeRootFor(path: string | undefined, cwd: string): string {
  if (!path) return cwd;
  if (isUnder(cwd, path)) return cwd;
  return dirname(path) ?? path;
}

/**
 * A file tab: the frame, with the folder tree on one side and the file on
 * the other. The frame is the app's; what renders the file is the floor
 * today, and a widget once the runner in 14-composable-rail.md exists.
 */
export function FileView({ tab, session, driver, focusRequest, onOpenBeside }: Props) {
  const host = useHost();
  const canRead = useCapability('files');
  const [treeShown, setTreeShown] = useState(true);
  const frame = useRef<HTMLDivElement>(null);

  // The tree if there is one, else the text: whichever the keys should work in.
  useEffect(() => {
    if (!claimFocus(focusRequest ?? null, tab.id)) return;
    frame.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, [focusRequest, tab.id]);

  if (!canRead) return <div className="empty">This host cannot read files.</div>;

  const patch = (fields: Partial<Tab>) => driver.patchTab(session.id, tab.id, fields);
  const hasTree = Boolean(tab.root) && treeShown;

  const toggleTree = () => {
    if (tab.root) setTreeShown((shown) => !shown);
    else patch({ root: treeRootFor(tab.path, session.cwd) });
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

  return (
    <div className="fileview" ref={frame}>
      {hasTree && tab.root && (
        <FolderTree
          // A new root is a new tree: nothing expanded under the old one carries over.
          key={tab.root}
          root={tab.root}
          selected={tab.path}
          onReroot={(root) => patch({ root })}
          onShow={(path) => driver.showFile(session.id, tab.id, path)}
          onOpenBeside={onOpenBeside}
        />
      )}
      <div className="fileview-main">
        <div className="file-bar">
          {button('Folder tree', ICON.tree, toggleTree, hasTree)}
          <span className="file-path" title={shown}>
            {folder}
            <strong>{name}</strong>
          </span>
          {button('Open folder…', ICON.folder, () => void openFolder())}
          {button('Open externally', ICON.external, openExternally, false, !shown)}
        </div>
        {tab.path ? (
          // And a new file starts at the top, with nothing of the old one's.
          <TextView key={tab.path} path={tab.path} line={tab.line} />
        ) : (
          <div className="empty">{tab.root ? 'Choose a file from the tree.' : 'Nothing to show.'}</div>
        )}
      </div>
    </div>
  );
}
