import { useEffect, useId, useRef, useState } from 'react';
import { useDrag } from '../dnd/context';
import type { AgentState, Session, TabGroup, TabKind } from '../session/types';

const STATE_TITLE: Record<AgentState, string> = {
  working: 'Working',
  waiting: 'Needs your input',
  done: 'Done',
  error: 'Failed',
};

interface Props {
  session: Session;
  group: TabGroup;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onAdd: (kind: TabKind) => void;
}

export function TabBar({ session, group, onActivate, onClose, onAdd }: Props) {
  const { begin, register, action, payload } = useDrag();
  const barRef = useRef<HTMLDivElement>(null);
  const zoneId = useId();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(
    () =>
      register({
        id: `tabbar:${zoneId}`,
        priority: 2, // above the pane body, so the bar wins where they overlap
        getRect: () => barRef.current?.getBoundingClientRect() ?? null,
        resolve: (x) => {
          const bar = barRef.current;
          if (!bar) return null;
          const tabs = [...bar.querySelectorAll<HTMLElement>('[data-tab-id]')];
          let index = tabs.length;
          for (let i = 0; i < tabs.length; i++) {
            const rect = tabs[i].getBoundingClientRect();
            if (x < rect.left + rect.width / 2) {
              index = i;
              break;
            }
          }
          return { kind: 'tabbar', groupId: group.id, index };
        },
      }),
    [register, zoneId, group.id],
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
        <button className="icon-button subtle" title="New tab" onClick={() => setMenuOpen((v) => !v)}>
          +
        </button>
        {menuOpen && (
          <>
            <div className="menu-scrim" onClick={() => setMenuOpen(false)} />
            <div className="menu">
              <button
                onClick={() => {
                  onAdd('terminal');
                  setMenuOpen(false);
                }}
              >
                <span className="tab-glyph glyph-terminal" /> Terminal
              </button>
              <button
                onClick={() => {
                  onAdd('browser');
                  setMenuOpen(false);
                }}
              >
                <span className="tab-glyph glyph-browser" /> Browser
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
