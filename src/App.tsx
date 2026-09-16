import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { requestFocus, type FocusRequest } from './focusRequest';
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
  /**
   * The tab that should take keyboard focus.
   *
   * Set only by entering or creating something — never on mount or restore, or
   * the cursor would be yanked around on every split and every launch.
   */
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  /**
   * Put the cursor in the terminal when the app opens.
   *
   * Handled here, in the subscription itself, rather than in an effect
   * watching `sessions` — the arrival of the first workspace is the event, and
   * reacting to it directly avoids a render pass that exists only to notice it
   * happened. Once only: focusing on every workspace update would jump the
   * cursor whenever anything changed.
   */
  const openedRef = useRef(false);
  useEffect(
    () =>
      driver.subscribe((next) => {
        setSessions(next);
        if (openedRef.current || next.length === 0) return;
        openedRef.current = true;
        const first = next[0];
        const group = first.groups[Object.keys(first.groups)[0]];
        setActiveGroupId(group?.id ?? null);
        if (group?.activeTabId) setFocusRequest(requestFocus(group.activeTabId));
      }),
    [driver],
  );

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
      const created = driver.addTab(active.id, targetGroupId, kind);
      setFocusRequest(requestFocus(created.id));
    },
    [driver, active, targetGroupId],
  );

  const createSession = useCallback(() => {
    // Inherit the directory you are already working in. Agents ask permission
    // per directory, and the home folder is the one nobody should grant
    // wholesale — so a new session should land in the project you are in, not
    // back at ~.
    const inherited = sessions.find((s) => s.id === activeId)?.cwd;
    const created = driver.createSession({
      title: settings.defaultCommand.trim() || 'Shell',
      cwd: inherited ?? settings.defaultCwd.trim() ?? '~',
      branch: 'main',
      command: settings.defaultCommand,
    });
    setActiveId(created.id);
    setActiveGroupId(Object.keys(created.groups)[0] ?? null);
    // Land in the new terminal ready to type, rather than on the button that
    // opened it.
    const firstTab = Object.keys(created.tabs)[0];
    if (firstTab) setFocusRequest(requestFocus(firstTab));
  }, [driver, settings.defaultCommand, settings.defaultCwd, sessions, activeId]);

  /** Entering an existing session should also put the cursor in its terminal. */
  const selectSession = useCallback(
    (id: string) => {
      setActiveId(id);
      const session = sessions.find((s) => s.id === id);
      if (!session) return;
      const group = session.groups[Object.keys(session.groups)[0]];
      setActiveGroupId(group?.id ?? null);
      if (group?.activeTabId) setFocusRequest(requestFocus(group.activeTabId));
    },
    [sessions],
  );

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
            onSelect={selectSession}
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
                focusRequest={focusRequest}
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
