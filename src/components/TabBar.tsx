import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useDrag } from '../dnd/context';
import { resolveTabBarDrop } from '../dnd/zones';
import type { AgentState, Session, TabGroup, TabKind } from '../session/types';

const STATE_TITLE: Record<AgentState, string> = {
  working: 'Working',
  waiting: 'Needs your input',
  done: 'Done',
  error: 'Failed',
};

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
  const addRef = useRef<HTMLButtonElement>(null);
  // The tab bar scrolls horizontally, and overflow clips absolutely-positioned
  // children — so an in-flow dropdown is invisible and unclickable. The menu
  // is portalled to the body and placed from the button's own rect instead.
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

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
              {tab.agentState && (
                <span
                  className={`tab-state state-${tab.agentState}`}
                  title={STATE_TITLE[tab.agentState]}
                />
              )}
              <span className="tab-title">{tab.title}</span>
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
          ref={addRef}
          className="icon-button subtle"
          title="New tab"
          onClick={() => {
            if (menuAt) return setMenuAt(null);
            const rect = addRef.current?.getBoundingClientRect();
            setMenuAt(rect ? { x: rect.left, y: rect.bottom + 4 } : { x: 0, y: 0 });
          }}
        >
          +
        </button>
      </div>

      {menuAt &&
        createPortal(
          <>
            <div className="menu-scrim" onClick={() => setMenuAt(null)} />
            <div className="menu" style={{ left: menuAt.x, top: menuAt.y }}>
              <button
                onClick={() => {
                  onAdd('terminal');
                  setMenuAt(null);
                }}
              >
                <span className="tab-glyph glyph-terminal" /> Terminal
              </button>
              <button
                onClick={() => {
                  onAdd('browser');
                  setMenuAt(null);
                }}
              >
                <span className="tab-glyph glyph-browser" /> Browser
              </button>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
