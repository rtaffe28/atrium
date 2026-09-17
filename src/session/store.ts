import { leafGroupIds, removeLeaf, setSizesAt, splitLeaf } from '../layout/tree';
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
 * Push the id counter past every id in a restored workspace.
 *
 * The counter starts at zero each launch, but a restored session carries ids
 * minted by the *previous* run. Without this the first new pane after a
 * restart is handed an id that is already in use — and because groups are
 * keyed by id, creating it silently overwrites the existing pane and takes its
 * tabs with it. The tab has not been deleted; its group was clobbered.
 */
export function reserveIds(ids: Iterable<string>): void {
  for (const id of ids) {
    const n = Number(id.replace(/^[^0-9]*/, ''));
    if (Number.isFinite(n) && n > counter) counter = n;
  }
}

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

  /**
   * Start whatever backs this terminal tab.
   *
   * `command` is run inside the shell rather than replacing it, so when it
   * exits you are left at a prompt instead of watching the tab disappear.
   */
  protected abstract openTerminal(
    tabId: string,
    cwd: string,
    command?: string,
    restoring?: boolean,
  ): void;
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
  /**
   * Make a restored session internally consistent.
   *
   * A workspace file written by a buggy build outlives the bug, so restore has
   * to cope with one rather than trusting what it reads. Three things can be
   * wrong: a pane in the layout with no group, a group holding tabs but absent
   * from the layout, and a tab in no pane at all. Each is repaired toward
   * keeping the tab — losing a pane arrangement is annoying, losing a terminal
   * is not recoverable.
   */
  private sanitize(session: Session): Session {
    let layout = session.layout;
    const groups = { ...session.groups };

    // Panes referring to groups that no longer exist.
    for (const groupId of leafGroupIds(layout)) {
      if (!groups[groupId]) layout = removeLeaf(layout, groupId) ?? layout;
    }

    const placed = new Set(leafGroupIds(layout));
    const survivors = Object.keys(groups).filter((id) => placed.has(id));

    // Nothing placed at all: rebuild a single pane so the session still opens.
    if (survivors.length === 0) {
      const rescued = Object.keys(session.tabs);
      const groupId = uid('g');
      return {
        ...session,
        layout: { type: 'leaf', groupId },
        groups: { [groupId]: { id: groupId, tabIds: rescued, activeTabId: rescued[0] ?? null } },
      };
    }

    // Groups holding tabs but not shown anywhere: fold their tabs into a pane
    // that is, rather than dropping them.
    const home = groups[survivors[0]];
    for (const groupId of Object.keys(groups)) {
      if (placed.has(groupId)) continue;
      home.tabIds = [...home.tabIds, ...groups[groupId].tabIds];
      delete groups[groupId];
    }

    // Drop references to tabs that are gone, then re-home any tab left out.
    const seen = new Set<string>();
    for (const groupId of Object.keys(groups)) {
      groups[groupId] = {
        ...groups[groupId],
        tabIds: groups[groupId].tabIds.filter((id) => {
          if (!session.tabs[id] || seen.has(id)) return false;
          seen.add(id);
          return true;
        }),
      };
    }
    const orphans = Object.keys(session.tabs).filter((id) => !seen.has(id));
    if (orphans.length > 0) {
      groups[survivors[0]] = {
        ...groups[survivors[0]],
        tabIds: [...groups[survivors[0]].tabIds, ...orphans],
      };
    }

    for (const groupId of Object.keys(groups)) {
      const group = groups[groupId];
      if (!group.activeTabId || !group.tabIds.includes(group.activeTabId)) {
        groups[groupId] = { ...group, activeTabId: group.tabIds[0] ?? null };
      }
    }

    return { ...session, layout, groups };
  }

  hydrate(sessions: Session[], scrollback: Record<string, string>): void {
    if (sessions.length === 0) return;

    // Before anything else, or the first split after a restart collides.
    reserveIds(
      sessions.flatMap((session) => [
        session.id,
        ...Object.keys(session.groups),
        ...Object.keys(session.tabs),
      ]),
    );

    for (const session of sessions) {
      // Agent state described a process that no longer exists; claiming a
      // restored tab is still "working" would be a lie.
      const tabs = Object.fromEntries(
        Object.entries(session.tabs).map(([id, tab]) => [id, { ...tab, agentState: undefined }]),
      );
      this.sessions.set(session.id, this.sanitize({ ...session, tabs }));
    }
    this.notify();

    for (const session of this.sessions.values()) {
      for (const tab of Object.values(session.tabs)) {
        if (tab.kind !== 'terminal') continue;
        this.primeScrollback(tab.id, scrollback[tab.id] ?? '');
        // What was actually running wins over what the tab was created as.
        // `restoring` is the only case that should reopen a past conversation;
        // running an agent again by hand starts a new one.
        // The tab's own directory first: an agent's conversation is filed under
        // the directory it ran in, so reopening the tab anywhere else loses it.
        this.openTerminal(tab.id, tab.cwd ?? session.cwd, tab.command ?? tab.agent, true);
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
      // Every terminal gets one, not just tabs we launch an agent in: the
      // command is as likely to be typed by hand, and that tab deserves to
      // come back too.
      ...(kind === 'terminal' ? { agentSessionId: crypto.randomUUID() } : {}),
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
    // A new browser tab opens blank, on its URL bar. Any default here is a
    // guess at where you were going, and a wrong one costs a selection and a
    // retype.
    const tab = this.makeTab(kind);

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

  patchTab(sessionId: string, tabId: string, patch: Partial<Tab>): void {
    this.update(sessionId, (session) => ({
      ...session,
      tabs: { ...session.tabs, [tabId]: { ...session.tabs[tabId], ...patch } },
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
