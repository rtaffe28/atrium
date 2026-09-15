import { useCallback, useEffect, useMemo, useState } from 'react';
import { DragProvider } from './dnd/DragProvider';
import type { DragPayload } from './dnd/context';
import { HostProvider } from './host/HostProvider';
import { useHost } from './host/context';
import { MockHost } from './host/mock';
import type { Host } from './host/types';
import { useAgentNotifications } from './notifications';
import { SettingsProvider } from './settings/SettingsProvider';
import { useSettings } from './settings/context';
import { PaneTree } from './components/PaneTree';
import { SettingsPanel } from './components/SettingsPanel';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import type { DropAction, Session } from './session/types';

export default function App({ host }: { host?: Host }) {
  // Swapping this one line for ElectronHost is the entire graduation from
  // mock to product. Tests and main.tsx inject their own.
  const resolved = useMemo(() => host ?? new MockHost(), [host]);
  return (
    <HostProvider host={resolved}>
      <SettingsProvider>
        <Workspace />
      </SettingsProvider>
    </HostProvider>
  );
}

function Workspace() {
  const host = useHost();
  const driver = host.sessions;
  const { settings } = useSettings();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => driver.subscribe(setSessions), [driver]);

  useAgentNotifications(sessions);

  // activeId is only a preference. Resolving it during render means a killed
  // session falls back to the next one without an effect round-trip.
  const active = sessions.find((s) => s.id === activeId) ?? sessions[0] ?? null;

  // Where a new tab lands: the pane you last touched, falling back to the
  // first one so the title-bar buttons still work before you click anything.
  const targetGroupId =
    active && activeGroupId && active.groups[activeGroupId]
      ? activeGroupId
      : (active && Object.keys(active.groups)[0]) || null;

  const addTab = useCallback(
    (kind: 'terminal' | 'browser') => {
      if (!active || !targetGroupId) return;
      driver.addTab(active.id, targetGroupId, kind);
    },
    [driver, active, targetGroupId],
  );

  const createSession = useCallback(() => {
    const created = driver.createSession({
      title: settings.defaultCommand.trim() || 'Shell',
      cwd: '~',
      branch: 'main',
      command: settings.defaultCommand,
    });
    setActiveId(created.id);
  }, [driver, settings.defaultCommand]);

  // Persist the workspace shortly after it settles. Debounced because a
  // splitter drag fires a change per frame, and writing the whole workspace
  // sixty times a second would be absurd.
  useEffect(() => {
    if (!host.capabilities.persistence || sessions.length === 0) return;
    const timer = window.setTimeout(() => {
      void host.workspace.save({
        version: 1,
        sessions: driver.snapshot(),
        activeId: active?.id ?? null,
        scrollback: driver.scrollback(host.workspace.scrollbackBudget),
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [host, driver, sessions, active?.id]);

  const handleDrop = useCallback(
    (payload: DragPayload, action: DropAction) => {
      driver.moveTab(payload.sessionId, payload.tabId, action);
    },
    [driver],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        createSession();
      }
      if (event.key === ',') {
        event.preventDefault();
        setSettingsOpen(true);
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
          onOpenSettings={() => setSettingsOpen(true)}
          onNewTab={addTab}
          canAddTab={Boolean(active && targetGroupId)}
        />
        <div className="body">
          <Sidebar
            sessions={sessions}
            activeId={active?.id ?? null}
            onSelect={setActiveId}
            onCreate={createSession}
            onKill={(id) => driver.killSession(id)}
          />
          {/* Double-clicking the empty workspace opens a session — the same
              gesture as an empty desktop or a browser's tab strip. */}
          <main className="workspace" onDoubleClick={active ? undefined : createSession}>
            {active ? (
              <PaneTree
                node={active.layout}
                path={[]}
                session={active}
                driver={driver}
                onFocus={setActiveGroupId}
              />
            ) : (
              <div className="empty">
                <p>No sessions.</p>
                <button className="ghost-button" onClick={createSession}>
                  New session
                </button>
                <span className="empty-hint">or double-click anywhere here</span>
              </div>
            )}
          </main>
        </div>
      </div>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </DragProvider>
  );
}
