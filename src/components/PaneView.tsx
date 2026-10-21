import type { FocusRequest } from '../focusRequest';
import { useEffect, useId, useRef } from 'react';
import { useDrag } from '../dnd/context';
import { APPEND, resolvePaneZone } from '../dnd/zones';
import { titleFromUrl } from '../session/store';
import type { FileTarget, Session, SessionDriver, TabKind } from '../session/types';
import { BrowserView } from './BrowserView';
import { FileView } from './FileView';
import { TabBar } from './TabBar';
import { TerminalView } from './TerminalView';

interface Props {
  session: Session;
  groupId: string;
  driver: SessionDriver;
  onFocus: (groupId: string) => void;
  focusRequest?: FocusRequest | null;
}

/**
 * A leaf of the layout tree: one tab bar plus the active tab's content.
 *
 * The body registers a drop zone that reads which edge you are near, so
 * dropping a tab on the left quarter splits horizontally with the tab on the
 * left. Dropping in the middle moves it into this pane's tab bar instead.
 */
export function PaneView({ session, groupId, driver, onFocus, focusRequest }: Props) {
  const group = session.groups[groupId];
  const { register, action } = useDrag();
  const paneRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const zoneId = useId();

  // Priority 3 puts this above the tab bar's reorder zone, so an edge drag
  // along the bar splits rather than shuffling tabs.
  useEffect(
    () =>
      register({
        id: `pane:${zoneId}`,
        accepts: 'tab',
        priority: 3,
        getRect: () => paneRef.current?.getBoundingClientRect() ?? null,
        resolve: (x, y, rect) =>
          resolvePaneZone(
            x,
            y,
            rect,
            barRef.current?.getBoundingClientRect().height ?? 0,
            groupId,
          ),
      }),
    [register, zoneId, groupId],
  );

  if (!group) return null;

  const openLink = (url: string) => driver.openLinkBeside(session.id, groupId, url);
  // A path, with the same click and the same split as a link. It remembers
  // where it was opened from, which is where its tree goes if asked for.
  const paneCwd = (group.activeTabId && session.tabs[group.activeTabId]?.cwd) || session.cwd;
  const openFile = (target: FileTarget) =>
    driver.openFileBeside(
      session.id,
      groupId,
      target.kind === 'file' && !target.cwd ? { ...target, cwd: paneCwd } : target,
    );

  const activeTab = group.activeTabId ? session.tabs[group.activeTabId] : null;
  const splitPreview =
    action?.kind === 'split' && action.groupId === groupId ? action.edge : null;
  const movePreview =
    action?.kind === 'tabbar' && action.groupId === groupId && action.index === APPEND;

  return (
    <section className="pane" ref={paneRef} onPointerDownCapture={() => onFocus(groupId)}>
      <TabBar
        barRef={barRef}
        session={session}
        group={group}
        onActivate={(tabId) => driver.activateTab(session.id, groupId, tabId)}
        onClose={(tabId) => driver.closeTab(session.id, tabId)}
        onAdd={(kind: TabKind) => driver.addTab(session.id, groupId, kind)}
      />

      <div className="pane-body">
        {activeTab?.kind === 'terminal' && (
          <TerminalView
            tabId={activeTab.id}
            driver={driver}
            focusRequest={focusRequest}
            onOpenLink={openLink}
            onOpenFile={openFile}
            cwd={activeTab.cwd ?? session.cwd}
          />
        )}
        {activeTab?.kind === 'browser' && (
          <BrowserView
            // One address bar per tab: switching tabs must not carry the last
            // one's draft, spinner or back/forward state across.
            key={activeTab.id}
            tab={activeTab}
            // Moving to another site names the tab after it until the page
            // sends a title. Moving within one keeps the name it has: a route
            // change in an app rarely changes the title, and a reload never.
            onNavigate={(url) =>
              driver.patchTab(
                session.id,
                activeTab.id,
                titleFromUrl(url) === titleFromUrl(activeTab.url ?? '')
                  ? { url }
                  : { url, title: titleFromUrl(url) },
              )
            }
            onTitle={(title) => driver.patchTab(session.id, activeTab.id, { title })}
            focusRequest={focusRequest}
            onOpenLink={openLink}
          />
        )}
        {activeTab?.kind === 'file' && (
          <FileView
            // One frame per tab: the tree's expansion and the text's scroll
            // belong to the tab, not to the pane it is in.
            key={activeTab.id}
            tab={activeTab}
            session={session}
            driver={driver}
            focusRequest={focusRequest}
            onOpenBeside={openFile}
            onOpenLink={openLink}
          />
        )}
        {!activeTab && <div className="empty">Empty pane</div>}

        {splitPreview && <div className={`drop-preview edge-${splitPreview}`} />}
        {movePreview && <div className="drop-preview edge-full" />}
      </div>
    </section>
  );
}
