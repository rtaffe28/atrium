import { removeLeaf, setSizesAt, splitLeaf } from '../layout/tree';
import type {
  CreateSessionOptions,
  DataHandler,
  DropAction,
  LayoutNode,
  Session,
  SessionDriver,
  Tab,
  TabKind,
  Unsubscribe,
} from './types';

let counter = 0;
export const uid = (prefix: string) => `${prefix}${++counter}`;

/**
 * Sessions, tabs and pane layout — the part that is identical on every host.
 *
 * None of this touches a process. Splitting a pane, moving a tab between
 * groups and collapsing an emptied branch are UI state, so they live in the
 * renderer no matter what is on the other end of the terminal. Subclasses
 * supply only the terminal itself: scripted output for MockDriver, a real
 * pseudo-terminal over IPC for ElectronSessionDriver.
 */
export abstract class SessionStore implements SessionDriver {
  protected sessions = new Map<string, Session>();
  private listeners = new Set<(sessions: Session[]) => void>();

  // ── subclass hooks ───────────────────────────────────────────────────────

  /** Start whatever backs this terminal tab. */
  protected abstract openTerminal(tabId: string, cwd: string, agent?: string): void;
  /** Tear it down. Called for every tab of a killed session too. */
  protected abstract closeTerminal(tabId: string): void;

  abstract attach(tabId: string, onData: DataHandler): Unsubscribe;
  abstract write(tabId: string, data: string): void;
  abstract resize(tabId: string, cols: number, rows: number): void;
  abstract interrupt(tabId: string): void;

  // ── persistence ──────────────────────────────────────────────────────────

  /** The workspace shape, ready to serialise. */
  snapshot(): Session[] {
    return this.list();
  }

  /**
   * Put back a saved workspace.
   *
   * Terminals are respawned, not resumed — the previous processes died with
   * the app. Their scrollback is restored so the pane still reads as continuous,
   * and the command that created each tab runs again.
   */
  hydrate(sessions: Session[], scrollback: Record<string, string>): void {
    if (sessions.length === 0) return;

    for (const session of sessions) {
      // Agent state described a process that no longer exists; claiming a
      // restored tab is still "working" would be a lie.
      const tabs = Object.fromEntries(
        Object.entries(session.tabs).map(([id, tab]) => [id, { ...tab, agentState: undefined }]),
      );
      this.sessions.set(session.id, { ...session, tabs });
    }
    this.notify();

    for (const session of this.sessions.values()) {
      for (const tab of Object.values(session.tabs)) {
        if (tab.kind !== 'terminal') continue;
        this.primeScrollback(tab.id, scrollback[tab.id] ?? '');
        this.openTerminal(tab.id, session.cwd, tab.agent);
      }
    }
  }

  /** Seed a tab's replayable history before its process starts. */
  protected primeScrollback(_tabId: string, _history: string): void {
    // Subclasses that keep a buffer override this.
  }

  /** Per-tab history, for the next snapshot. */
  scrollback(_budget: number): Record<string, string> {
    return {};
  }

  // ── construction ─────────────────────────────────────────────────────────

  protected makeTab(kind: TabKind, partial: Partial<Tab> = {}): Tab {
    return {
      id: uid('t'),
      kind,
      title: kind === 'browser' ? 'New tab' : 'zsh',
      ...partial,
    };
  }

  protected makeSession(
    title: string,
    branch: string,
    tabs: Tab[],
    ageMinutes: number,
    cwd = '~',
  ): Session {
    const groupId = uid('g');
    return {
      id: uid('s'),
      title,
      cwd,
      branch,
      createdAt: Date.now() - ageMinutes * 60_000,
      diff: { files: 0, added: 0, removed: 0 },
      layout: { type: 'leaf', groupId },
      groups: {
        [groupId]: {
          id: groupId,
          tabIds: tabs.map((t) => t.id),
          activeTabId: tabs[0]?.id ?? null,
        },
      },
      tabs: Object.fromEntries(tabs.map((t) => [t.id, t])),
    };
  }

  // ── state plumbing ───────────────────────────────────────────────────────

  protected update(sessionId: string, fn: (session: Session) => Session) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.set(sessionId, fn(session));
    this.notify();
  }

  protected notify() {
    const list = this.list();
    for (const listener of this.listeners) listener(list);
  }

  protected sessionOfTab(tabId: string): Session | undefined {
    return [...this.sessions.values()].find((s) => s.tabs[tabId]);
  }

  list(): Session[] {
    return [...this.sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  subscribe(handler: (sessions: Session[]) => void): Unsubscribe {
    this.listeners.add(handler);
    handler(this.list());
    return () => this.listeners.delete(handler);
  }

  // ── sessions ─────────────────────────────────────────────────────────────

  createSession(options: CreateSessionOptions): Session {
    const command = options.command?.trim();
    const tab =
      options.adopt ??
      this.makeTab('terminal', {
        title: command || 'zsh',
        ...(command ? { agent: command } : {}),
      });
    const session = this.makeSession(options.title, options.branch, [tab], 0, options.cwd);
    this.sessions.set(session.id, session);
    this.notify();
    if (!options.adopt && tab.kind === 'terminal') {
      this.openTerminal(tab.id, options.cwd, tab.agent);
    }
    return session;
  }

  killSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    for (const tabId of Object.keys(session.tabs)) this.closeTerminal(tabId);
    this.sessions.delete(sessionId);
    this.notify();
  }

  // ── tabs ─────────────────────────────────────────────────────────────────

  addTab(sessionId: string, groupId: string, kind: TabKind): Tab {
    const session = this.sessions.get(sessionId);
    const tab =
      kind === 'browser'
        ? this.makeTab('browser', { title: 'New tab', url: 'http://localhost:5173/' })
        : this.makeTab('terminal', { title: 'zsh' });

    this.update(sessionId, (s) => ({
      ...s,
      tabs: { ...s.tabs, [tab.id]: tab },
      groups: {
        ...s.groups,
        [groupId]: {
          ...s.groups[groupId],
          tabIds: [...s.groups[groupId].tabIds, tab.id],
          activeTabId: tab.id,
        },
      },
    }));

    if (kind === 'terminal' && session) this.openTerminal(tab.id, session.cwd);
    return tab;
  }

  closeTab(sessionId: string, tabId: string): void {
    this.closeTerminal(tabId);

    const session = this.sessions.get(sessionId);
    if (!session) return;

    const groupId = Object.keys(session.groups).find((g) =>
      session.groups[g].tabIds.includes(tabId),
    );
    if (!groupId) return;

    const remaining = session.groups[groupId].tabIds.filter((id) => id !== tabId);
    const tabs = { ...session.tabs };
    delete tabs[tabId];

    // Last tab in a pane: drop the pane and collapse the split around it.
    if (remaining.length === 0) {
      const layout = removeLeaf(session.layout, groupId);
      if (layout === null) {
        this.killSession(sessionId);
        return;
      }
      const groups = { ...session.groups };
      delete groups[groupId];
      this.update(sessionId, (s) => ({ ...s, tabs, groups, layout }));
      return;
    }

    this.update(sessionId, (s) => ({
      ...s,
      tabs,
      groups: {
        ...s.groups,
        [groupId]: {
          ...s.groups[groupId],
          tabIds: remaining,
          activeTabId:
            s.groups[groupId].activeTabId === tabId
              ? remaining[remaining.length - 1]
              : s.groups[groupId].activeTabId,
        },
      },
    }));
  }

  activateTab(sessionId: string, groupId: string, tabId: string): void {
    this.update(sessionId, (session) => ({
      ...session,
      groups: {
        ...session.groups,
        [groupId]: { ...session.groups[groupId], activeTabId: tabId },
      },
    }));
  }

  setTabUrl(sessionId: string, tabId: string, url: string): void {
    this.update(sessionId, (session) => ({
      ...session,
      tabs: {
        ...session.tabs,
        [tabId]: {
          ...session.tabs[tabId],
          url,
          title: url.replace(/^https?:\/\//, '').split('/')[0] || 'New tab',
        },
      },
    }));
  }

  // ── layout ───────────────────────────────────────────────────────────────

  moveTab(sessionId: string, tabId: string, action: DropAction): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const fromGroupId = Object.keys(session.groups).find((g) =>
      session.groups[g].tabIds.includes(tabId),
    );
    if (!fromGroupId) return;

    // Dropped on the rail: the tab graduates into a session of its own.
    if (action.kind === 'rail') {
      const tab = session.tabs[tabId];
      const onlyTab = session.groups[fromGroupId].tabIds.length === 1;
      const onlyGroup = Object.keys(session.groups).length === 1;
      if (onlyTab && onlyGroup) return; // already is its own session

      this.detach(sessionId, fromGroupId, tabId);
      const created = this.makeSession(tab.title, session.branch, [tab], 0, session.cwd);
      this.sessions.set(created.id, created);
      this.notify();
      return;
    }

    if (action.kind === 'tabbar') {
      const sameGroup = fromGroupId === action.groupId;
      const current = this.sessions.get(sessionId);
      if (!current) return;
      const source = current.groups[fromGroupId].tabIds.filter((id) => id !== tabId);
      const targetIds = sameGroup ? source : [...current.groups[action.groupId].tabIds];
      const index = Math.min(action.index, targetIds.length);
      targetIds.splice(index, 0, tabId);

      const groups = { ...current.groups };
      groups[action.groupId] = {
        ...groups[action.groupId],
        tabIds: targetIds,
        activeTabId: tabId,
      };
      if (!sameGroup) {
        groups[fromGroupId] = {
          ...groups[fromGroupId],
          tabIds: source,
          activeTabId: source[source.length - 1] ?? null,
        };
      }

      let layout = current.layout;
      if (!sameGroup && source.length === 0) {
        layout = removeLeaf(current.layout, fromGroupId) ?? current.layout;
        delete groups[fromGroupId];
      }
      this.update(sessionId, (s) => ({ ...s, groups, layout }));
      return;
    }

    // Split: the dragged tab becomes a new pane on the chosen edge.
    const onlyTabInGroup = session.groups[fromGroupId].tabIds.length === 1;
    if (onlyTabInGroup && fromGroupId === action.groupId) return;

    const newGroupId = uid('g');
    this.detach(sessionId, fromGroupId, tabId);

    const current = this.sessions.get(sessionId);
    if (!current) return;
    const anchor = current.groups[action.groupId]
      ? action.groupId
      : Object.keys(current.groups)[0];

    this.update(sessionId, (s) => ({
      ...s,
      layout: splitLeaf(s.layout, anchor, newGroupId, action.edge),
      groups: {
        ...s.groups,
        [newGroupId]: { id: newGroupId, tabIds: [tabId], activeTabId: tabId },
      },
    }));
  }

  /** Pull a tab out of its group, collapsing the pane if it was the last one. */
  private detach(sessionId: string, groupId: string, tabId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const remaining = session.groups[groupId].tabIds.filter((id) => id !== tabId);
    const groups = { ...session.groups };
    let layout = session.layout;

    if (remaining.length === 0) {
      layout = removeLeaf(session.layout, groupId) ?? session.layout;
      delete groups[groupId];
    } else {
      groups[groupId] = {
        ...groups[groupId],
        tabIds: remaining,
        activeTabId:
          groups[groupId].activeTabId === tabId
            ? remaining[remaining.length - 1]
            : groups[groupId].activeTabId,
      };
    }
    this.sessions.set(sessionId, { ...session, groups, layout });
  }

  setSizes(sessionId: string, path: number[], sizes: [number, number]): void {
    this.update(sessionId, (session) => ({
      ...session,
      layout: setSizesAt(session.layout, path, sizes) as LayoutNode,
    }));
  }
}
