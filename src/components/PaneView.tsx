import { useEffect, useId, useRef } from 'react';
import { useDrag } from '../dnd/context';
import type { Session, SessionDriver, TabKind } from '../session/types';
import { BrowserView } from './BrowserView';
import { TabBar } from './TabBar';
import { TerminalView } from './TerminalView';

const EDGE_BAND = 0.28;

interface Props {
  session: Session;
  groupId: string;
  driver: SessionDriver;
}

/**
 * A leaf of the layout tree: one tab bar plus the active tab's content.
 *
 * The body registers a drop zone that reads which edge you are near, so
 * dropping a tab on the left quarter splits horizontally with the tab on the
 * left. Dropping in the middle moves it into this pane's tab bar instead.
 */
export function PaneView({ session, groupId, driver }: Props) {
  const group = session.groups[groupId];
  const { register, action } = useDrag();
  const bodyRef = useRef<HTMLDivElement>(null);
  const zoneId = useId();

  useEffect(
    () =>
      register({
        id: `pane:${zoneId}`,
        priority: 1,
        getRect: () => bodyRef.current?.getBoundingClientRect() ?? null,
        resolve: (x, y, rect) => {
          const fx = (x - rect.left) / rect.width;
          const fy = (y - rect.top) / rect.height;
          const distances = [
            { edge: 'left' as const, d: fx },
            { edge: 'right' as const, d: 1 - fx },
            { edge: 'top' as const, d: fy },
            { edge: 'bottom' as const, d: 1 - fy },
          ].sort((a, b) => a.d - b.d);

          if (distances[0].d < EDGE_BAND) {
            return { kind: 'split', groupId, edge: distances[0].edge };
          }
          return { kind: 'tabbar', groupId, index: Number.MAX_SAFE_INTEGER };
        },
      }),
    [register, zoneId, groupId],
  );

  if (!group) return null;

  const activeTab = group.activeTabId ? session.tabs[group.activeTabId] : null;
  const splitPreview =
    action?.kind === 'split' && action.groupId === groupId ? action.edge : null;
  const movePreview =
    action?.kind === 'tabbar' &&
    action.groupId === groupId &&
    action.index === Number.MAX_SAFE_INTEGER;

  return (
    <section className="pane">
      <TabBar
        session={session}
        group={group}
        onActivate={(tabId) => driver.activateTab(session.id, groupId, tabId)}
        onClose={(tabId) => driver.closeTab(session.id, tabId)}
        onAdd={(kind: TabKind) => driver.addTab(session.id, groupId, kind)}
      />

      <div className="pane-body" ref={bodyRef}>
        {activeTab?.kind === 'terminal' && (
          <TerminalView tabId={activeTab.id} driver={driver} />
        )}
        {activeTab?.kind === 'browser' && (
          <BrowserView
            tab={activeTab}
            onNavigate={(url) => driver.setTabUrl(session.id, activeTab.id, url)}
          />
        )}
        {!activeTab && <div className="empty">Empty pane</div>}

        {splitPreview && <div className={`drop-preview edge-${splitPreview}`} />}
        {movePreview && <div className="drop-preview edge-full" />}
      </div>
    </section>
  );
}
