import { useEffect, useId, type RefObject } from 'react';
import { useDrag } from '../dnd/context';
import { resolveTabBarDrop } from '../dnd/zones';
import type { Session, TabGroup, TabKind } from '../session/types';
import { isWorking } from '../session/signals';

interface Props {
  /** Owned by PaneView, which needs the bar's height to place its split bands. */
  barRef: RefObject<HTMLDivElement | null>;
  session: Session;
  group: TabGroup;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onAdd: (kind: TabKind) => void;
}

export function TabBar({ barRef, session, group, onActivate, onClose, onAdd }: Props) {
  const { begin, register, action, payload } = useDrag();
  const zoneId = useId();

  useEffect(
    () =>
      register({
        id: `tabbar:${zoneId}`,
        priority: 2, // above the pane body, so the bar wins where they overlap
        getRect: () => barRef.current?.getBoundingClientRect() ?? null,
        resolve: (x) => {
          const bar = barRef.current;
          if (!bar) return null;
          const rects = [...bar.querySelectorAll<HTMLElement>('[data-tab-id]')].map((el) =>
            el.getBoundingClientRect(),
          );
          return resolveTabBarDrop(x, rects, group.id);
        },
      }),
    [register, zoneId, group.id, barRef],
  );

  const dropIndex =
    action?.kind === 'tabbar' && action.groupId === group.id ? action.index : null;

  return (
    <div className="tabbar" ref={barRef}>
      {group.tabIds.map((tabId, i) => {
        const tab = session.tabs[tabId];
        if (!tab) return null;
        const active = group.activeTabId === tabId;
        const dragging = payload?.tabId === tabId;

        return (
          <div key={tabId} className="tab-slot">
            {dropIndex === i && <span className="tab-insert" />}
            <div
              data-tab-id={tabId}
              className={`tab${active ? ' is-active' : ''}${dragging ? ' is-dragging' : ''}`}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                onActivate(tabId);
                begin(
                  { tabId, sessionId: session.id, title: tab.title, kind: tab.kind },
                  event,
                );
              }}
            >
              <span className={`tab-glyph glyph-${tab.kind}`} />
              {/* The program's own title wins while it runs, as in any terminal. */}
              <span className="tab-title">{tab.programTitle || tab.title}</span>
              {tab.attention && (
                <span className="attention-mark" title="Asked for your attention" />
              )}
              {isWorking(tab) && <span className="working-dot" title="Working" />}
              <button
                className="tab-close"
                title="Close tab"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tabId);
                }}
              >
                ×
              </button>
            </div>
          </div>
        );
      })}

      {dropIndex !== null && dropIndex >= group.tabIds.length && <span className="tab-insert" />}

      <div className="tab-add">
        <button
          className="icon-button subtle"
          title="New terminal in this pane"
          onClick={() => onAdd('terminal')}
        >
          +
        </button>
      </div>
    </div>
  );
}
