import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTerminalAlerts } from './alerts';
import { DragProvider } from './dnd/DragProvider';
import type { DragPayload } from './dnd/context';
import { HostProvider } from './host/HostProvider';
import { useHost } from './host/context';
import { MockHost } from './host/mock';
import type { Host } from './host/types';
import { COMMANDS, matches } from './keyboard/commands';
import { SettingsProvider } from './settings/SettingsProvider';
import { useSettings } from './settings/context';
import { PaneTree } from './components/PaneTree';
import { SettingsPanel } from './components/SettingsPanel';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { requestFocus, type FocusRequest } from './focusRequest';
import type { DropAction, Session, TabKind } from './session/types';

/** How long the workspace must be still before it is saved. */
const SAVE_DEBOUNCE_MS = 700;
/** The longest a save waits for that while things keep changing. */
const SAVE_MAX_WAIT_MS = 5000;

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

  // activeId is only a preference. Resolving it during render means a killed
  // session falls back to the next one without an effect round-trip.
  const active = sessions.find((s) => s.id === activeId) ?? sessions[0] ?? null;

  // Where a new tab lands: the pane you last touched, falling back to the
  // first one so the title-bar buttons still work before you click anything.
  const targetGroupId =
    active && activeGroupId && active.groups[activeGroupId]
      ? activeGroupId
      : (active && Object.keys(active.groups)[0]) || null;

  const [windowFocused, setWindowFocused] = useState(() =>
    typeof document === 'undefined' ? true : document.hasFocus(),
  );
  useEffect(() => host.window.subscribe((state) => setWindowFocused(state.focused)), [host]);

  // The tab in front of you, as a terminal means it: the active tab of the
  // focused pane, in a window that has focus. It is never alerted for, and
  // looking at a tab is what clears its mark.
  const focusedTabId =
    windowFocused && active && targetGroupId
      ? (active.groups[targetGroupId]?.activeTabId ?? null)
      : null;
  useEffect(() => driver.setFocusedTab(focusedTabId), [driver, focusedTabId]);

  /** Bring a tab to the front: its session, its pane, and the cursor. */
  const revealTab = useCallback(
    (tabId: string) => {
      const session = sessions.find((s) => s.tabs[tabId]);
      if (!session) return;
      const group = Object.values(session.groups).find((g) => g.tabIds.includes(tabId));
      if (!group) return;
      driver.activateTab(session.id, group.id, tabId);
      setActiveId(session.id);
      setActiveGroupId(group.id);
      setFocusRequest(requestFocus(tabId));
    },
    [driver, sessions],
  );

  useTerminalAlerts(sessions, windowFocused, revealTab);

  const addTab = useCallback(
    (kind: TabKind) => {
      if (!active || !targetGroupId) return;
      const created = driver.addTab(active.id, targetGroupId, kind);
      setFocusRequest(requestFocus(created.id));
    },
    [driver, active, targetGroupId],
  );

  /**
   * Open a session running `command` — or a plain shell, when it is blank.
   *
   * The directory is always inherited from the terminal you are in. Agents ask
   * permission per directory, and the home folder is the one nobody should
   * grant wholesale, so a new session lands in the project you are already
   * working in rather than back at ~. With nothing to inherit from there is no
   * better answer than ~, and that is the first session only.
   *
   * The tab's directory before the session's: the session's is where it was
   * opened, which stops being true the moment you cd, and cd-ing to the
   * project you want and opening a session there is the obvious gesture.
   */
  const openSession = useCallback(
    (command: string) => {
      const group = active && targetGroupId ? active.groups[targetGroupId] : null;
      const tab = group?.activeTabId ? active?.tabs[group.activeTabId] : null;
      const inherited = tab?.cwd || active?.cwd;
      const created = driver.createSession({
        title: command.trim() || 'Shell',
        cwd: inherited || '~',
        branch: 'main',
        command,
      });
      setActiveId(created.id);
      setActiveGroupId(Object.keys(created.groups)[0] ?? null);
      // Land in the new terminal ready to type, rather than on the button that
      // opened it.
      const firstTab = Object.keys(created.tabs)[0];
      if (firstTab) setFocusRequest(requestFocus(firstTab));
    },
    [driver, active, targetGroupId],
  );

  // Both take no arguments on purpose: they are handed straight to onClick and
  // onDoubleClick, and a handler that accepted one would be passed a
  // MouseEvent as its command.
  const createSession = useCallback(
    () => openSession(settings.defaultCommand),
    [openSession, settings.defaultCommand],
  );
  const createShellSession = useCallback(() => openSession(''), [openSession]);

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
  //
  // But never put off for longer than SAVE_MAX_WAIT_MS. A working agent
  // animates its title several times a second, every frame is a change, and a
  // pure debounce would not save at all until the turn ended — a crash midway
  // through a long run would lose everything done during it.
  const pendingSince = useRef<number | null>(null);
  useEffect(() => {
    if (!host.capabilities.persistence || sessions.length === 0) return;
    const now = Date.now();
    pendingSince.current ??= now;
    const wait = Math.min(SAVE_DEBOUNCE_MS, pendingSince.current + SAVE_MAX_WAIT_MS - now);
    const timer = window.setTimeout(
      () => {
        pendingSince.current = null;
        void host.workspace.save({
          version: 1,
          sessions: driver.snapshot(),
          activeId: active?.id ?? null,
          scrollback: driver.scrollback(host.workspace.scrollbackBudget),
        });
      },
      Math.max(0, wait),
    );
    return () => window.clearTimeout(timer);
  }, [host, driver, sessions, active?.id]);

  const handleDrop = useCallback(
    (payload: DragPayload, action: DropAction) => {
      driver.moveTab(payload.sessionId, payload.tabId, action);
    },
    [driver],
  );

  useEffect(() => {
    const run: Record<string, () => void> = {
      'session.new': createSession,
      'tab.newTerminal': () => addTab('terminal'),
      'tab.close': () => {
        const tabId = active && targetGroupId ? active.groups[targetGroupId]?.activeTabId : null;
        if (active && tabId) driver.closeTab(active.id, tabId);
      },
      'settings.open': () => setSettingsOpen(true),
    };

    const onKey = (event: KeyboardEvent) => {
      const command = COMMANDS.find((c) => matches(event, c.keys));
      if (!command) return;
      event.preventDefault();
      run[command.id]?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [createSession, addTab, driver, active, targetGroupId]);

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
            onCreateShell={createShellSession}
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
