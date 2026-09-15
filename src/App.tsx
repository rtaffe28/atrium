import { useEffect, useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { TerminalView } from './components/TerminalView';
import { TitleBar } from './components/TitleBar';
import { MockDriver } from './session/mock';
import type { SessionMeta } from './session/types';

export default function App() {
  // Swapping this one line for a real PTY driver is the entire graduation
  // from mock to product.
  const driver = useMemo(() => new MockDriver(), []);

  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => driver.subscribe(setSessions), [driver]);

  useEffect(() => {
    if (activeId === null && sessions.length > 0) setActiveId(sessions[0].id);
  }, [sessions, activeId]);

  const active = sessions.find((s) => s.id === activeId) ?? null;

  const createSession = () => {
    void driver
      .create({
        title: 'New session',
        agent: 'claude',
        cwd: '~/git/atrium',
        branch: `ryan/session-${Math.random().toString(36).slice(2, 7)}`,
      })
      .then((meta) => setActiveId(meta.id));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        createSession();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="app">
      <TitleBar session={active} />
      <div className="body">
        <Sidebar
          sessions={sessions}
          activeId={activeId}
          onSelect={setActiveId}
          onCreate={createSession}
        />
        <main className="pane">
          {active ? (
            <>
              <div className="pane-head">
                <span className="pane-title">{active.title}</span>
                <span className="pane-actions">
                  <button
                    className="ghost-button"
                    onClick={() => driver.interrupt(active.id)}
                  >
                    Interrupt
                  </button>
                  <button
                    className="ghost-button danger"
                    onClick={() => {
                      driver.kill(active.id);
                      setActiveId(null);
                    }}
                  >
                    Kill
                  </button>
                </span>
              </div>
              <TerminalView sessionId={active.id} driver={driver} />
            </>
          ) : (
            <div className="empty">
              <p>No session selected.</p>
              <button className="ghost-button" onClick={createSession}>
                New session
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
