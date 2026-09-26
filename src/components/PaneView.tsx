import { claimFocus, type FocusRequest } from '../focusRequest';
import { useEffect, useId, useRef } from 'react';
import { useDrag } from '../dnd/context';
import { APPEND, resolvePaneZone } from '../dnd/zones';
import { titleFromUrl } from '../session/store';
import type { Session, SessionDriver, TabKind } from '../session/types';
import { BrowserView } from './BrowserView';
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
          />
        )}
        {activeTab?.kind === 'browser' && (
          <BrowserView
            tab={activeTab}
            onNavigate={(url) =>
              driver.patchTab(session.id, activeTab.id, {
                url,
                title: titleFromUrl(url),
              })
            }
            focusUrlBar={claimFocus(focusRequest ?? null, activeTab.id)}
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
