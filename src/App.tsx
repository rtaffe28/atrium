import { useCallback, useEffect, useMemo, useState } from 'react';
import { DragProvider } from './dnd/DragProvider';
import type { DragPayload } from './dnd/context';
import {
  notificationPermission,
  requestNotificationPermission,
  useAgentNotifications,
} from './notifications';
import { PaneTree } from './components/PaneTree';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { MockDriver } from './session/mock';
import type { DropAction, Session } from './session/types';

export default function App() {
  // Swapping this one line for a real PTY driver is the entire graduation
  // from mock to product.
  const driver = useMemo(() => new MockDriver(), []);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [permission, setPermission] = useState(notificationPermission());

  useEffect(() => driver.subscribe(setSessions), [driver]);

  useAgentNotifications(sessions, permission === 'granted');

  // activeId is only a preference. Resolving it during render means a killed
  // session falls back to the next one without an effect round-trip.
  const active = sessions.find((s) => s.id === activeId) ?? sessions[0] ?? null;

  const createSession = useCallback(() => {
    const created = driver.createSession({
      title: 'New session',
      cwd: '~/git/atrium',
      branch: `ryan/session-${Math.random().toString(36).slice(2, 7)}`,
    });
    setActiveId(created.id);
  }, [driver]);

  const handleDrop = useCallback(
    (payload: DragPayload, action: DropAction) => {
      driver.moveTab(payload.sessionId, payload.tabId, action);
    },
    [driver],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        createSession();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [createSession]);

  return (
    <DragProvider onDrop={handleDrop}>
      <div className="app">
        <TitleBar
          session={active}
          permission={permission}
          onEnableNotifications={() => void requestNotificationPermission().then(setPermission)}
        />
        <div className="body">
          <Sidebar
            sessions={sessions}
            activeId={activeId}
            onSelect={setActiveId}
            onCreate={createSession}
            onKill={(id) => driver.killSession(id)}
          />
          <main className="workspace">
            {active ? (
              <PaneTree node={active.layout} path={[]} session={active} driver={driver} />
            ) : (
              <div className="empty">
                <p>No sessions.</p>
                <button className="ghost-button" onClick={createSession}>
                  New session
                </button>
              </div>
            )}
          </main>
        </div>
      </div>
    </DragProvider>
  );
}
