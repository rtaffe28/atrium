import { removeLeaf, setSizesAt, splitLeaf } from '../layout/tree';
import type {
  AgentState,
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

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
} as const;

interface Beat {
  after: number;
  text: string;
  agentState?: AgentState;
  diff?: { files: number; added: number; removed: number };
}

const prompt = (cwd: string) => `${C.dim}${cwd}${C.reset} ${C.green}❯${C.reset} `;

const banner = `${C.magenta}✻${C.reset} ${C.bold}Atrium${C.reset} ${C.dim}· Opus 5${C.reset}\r\n\r\n`;

function agentScript(cwd: string, task: string, files: string[]): Beat[] {
  const beats: Beat[] = [
    { after: 300, text: `${prompt(cwd)}claude "${task}"\r\n\r\n` },
    { after: 700, text: banner, agentState: 'working' },
    { after: 900, text: `  ${C.dim}Reading the surrounding code…${C.reset}\r\n` },
  ];
  let added = 0;
  let removed = 0;
  files.forEach((file, i) => {
    const a = 12 + i * 19;
    const r = 3 + i * 4;
    added += a;
    removed += r;
    beats.push({
      after: 1100 + i * 250,
      text: `  ${C.green}✔${C.reset} Edit ${C.cyan}${file}${C.reset}  ${C.green}+${a}${C.reset} ${C.red}-${r}${C.reset}\r\n`,
      diff: { files: i + 1, added, removed },
    });
  });
  beats.push(
    { after: 1200, text: `\r\n  ${C.dim}Running tests…${C.reset}\r\n` },
    { after: 1800, text: `  ${C.green}✔${C.reset} ${C.dim}47 passed, 0 failed${C.reset}\r\n\r\n` },
    {
      after: 700,
      text: `${C.bold}Done.${C.reset} ${task} — ${files.length} files touched.\r\n\r\n`,
      agentState: 'done',
    },
    { after: 200, text: prompt(cwd) },
  );
  return beats;
}

function waitingScript(cwd: string): Beat[] {
  return [
    { after: 300, text: `${prompt(cwd)}claude "migrate the auth flow"\r\n\r\n` },
    { after: 800, text: banner, agentState: 'working' },
    { after: 900, text: `  ${C.dim}Tracing the current session handling…${C.reset}\r\n` },
    {
      after: 2400,
      text:
        `  ${C.yellow}?${C.reset} Two call sites set the cookie directly.\r\n` +
        `    Route both through ${C.cyan}createSession()${C.reset}, or leave\r\n` +
        `    the legacy admin path alone?\r\n\r\n` +
        `  ${C.dim}[1]${C.reset} Route both  ${C.dim}[2]${C.reset} Leave admin  ${C.dim}[3]${C.reset} Explain\r\n\r\n` +
        `  ${C.yellow}❯${C.reset} `,
      agentState: 'waiting',
    },
  ];
}

function devServerScript(cwd: string): Beat[] {
  return [
    { after: 200, text: `${prompt(cwd)}npm run dev\r\n\r\n` },
    { after: 900, text: `  ${C.dim}VITE v8.3.0  ready in 143 ms${C.reset}\r\n\r\n` },
    { after: 300, text: `  ${C.green}➜${C.reset}  Local:   ${C.cyan}http://localhost:5173/${C.reset}\r\n\r\n` },
  ];
}

function buildErrorScript(cwd: string): Beat[] {
  return [
    { after: 300, text: `${prompt(cwd)}npm run build\r\n\r\n`, agentState: 'working' },
    { after: 900, text: `${C.dim}vite v8.3.0 building for production…${C.reset}\r\n` },
    { after: 1100, text: `${C.dim}transforming (218)…${C.reset}\r\n` },
    {
      after: 1400,
      text:
        `\r\n${C.red}✘ [ERROR]${C.reset} Could not resolve ${C.cyan}"./session/pty"${C.reset}\r\n\r\n` +
        `    ${C.dim}src/session/index.ts:4:24${C.reset}\r\n` +
        `      ${C.dim}4 │${C.reset} export { PtyDriver } from ${C.green}'./session/pty'${C.reset}\r\n` +
        `        ${C.dim}│${C.reset}                          ${C.red}~~~~~~~~~~~~~~~${C.reset}\r\n\r\n` +
        `${C.red}error${C.reset} Build failed with 1 error.\r\n\r\n`,
      agentState: 'error',
    },
    { after: 200, text: prompt(cwd) },
  ];
}

interface Stream {
  buffer: string;
  listeners: Set<DataHandler>;
  timers: number[];
}

let counter = 0;
const uid = (prefix: string) => `${prefix}${++counter}`;

export class MockDriver implements SessionDriver {
  private sessions = new Map<string, Session>();
  private streams = new Map<string, Stream>();
  private listeners = new Set<(s: Session[]) => void>();

  constructor() {
    this.seed();
  }

  // ── construction helpers ───────────────────────────────────────────────

  private makeTab(kind: TabKind, partial: Partial<Tab> = {}): Tab {
    return {
      id: uid('t'),
      kind,
      title: kind === 'browser' ? 'New tab' : 'zsh',
      ...partial,
    };
  }

  private makeSession(
    title: string,
    branch: string,
    tabs: Tab[],
    ageMinutes: number,
  ): Session {
    const groupId = uid('g');
    return {
      id: uid('s'),
      title,
      cwd: '~/git/atrium',
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

  private seed() {
    const cwd = '~/git/atrium';

    const a1 = this.makeTab('terminal', { title: 'claude', agent: 'claude' });
    const a2 = this.makeTab('terminal', { title: 'dev server' });
    const s1 = this.makeSession('Session rail + status dots', 'ryan/session-rail', [a1, a2], 14);

    const b1 = this.makeTab('terminal', { title: 'claude', agent: 'claude' });
    const b2 = this.makeTab('browser', { title: 'Preview', url: 'http://localhost:5173/' });
    const s2 = this.makeSession('Auth flow migration', 'ryan/auth-migration', [b1, b2], 6);

    const c1 = this.makeTab('terminal', { title: 'build', agent: 'shell' });
    const s3 = this.makeSession('Production build', 'main', [c1], 3);

    const d1 = this.makeTab('terminal', { title: 'claude', agent: 'claude' });
    const s4 = this.makeSession('WebGL renderer spike', 'ryan/webgl-spike', [d1], 31);

    for (const session of [s1, s2, s3, s4]) this.sessions.set(session.id, session);

    this.play(s1.id, a1.id, agentScript(cwd, 'build the session rail', [
      'src/components/Sidebar.tsx',
      'src/index.css',
      'src/App.tsx',
    ]));
    this.play(s1.id, a2.id, devServerScript(cwd));
    this.play(s2.id, b1.id, waitingScript(cwd));
    this.play(s3.id, c1.id, buildErrorScript(cwd));
    this.play(s4.id, d1.id, agentScript(cwd, 'try the WebGL addon', [
      'src/components/TerminalView.tsx',
      'package.json',
    ]));
  }

  // ── stream plumbing ────────────────────────────────────────────────────

  private stream(tabId: string): Stream {
    let stream = this.streams.get(tabId);
    if (!stream) {
      stream = { buffer: '', listeners: new Set(), timers: [] };
      this.streams.set(tabId, stream);
    }
    return stream;
  }

  private emit(tabId: string, text: string) {
    const stream = this.stream(tabId);
    stream.buffer += text;
    for (const listener of stream.listeners) listener(text);
  }

  private play(sessionId: string, tabId: string, script: Beat[]) {
    const stream = this.stream(tabId);
    let elapsed = 0;
    for (const beat of script) {
      elapsed += beat.after;
      stream.timers.push(
        window.setTimeout(() => {
          this.emit(tabId, beat.text);
          if (beat.agentState || beat.diff) {
            this.update(sessionId, (session) => ({
              ...session,
              diff: beat.diff ?? session.diff,
              tabs: beat.agentState
                ? {
                    ...session.tabs,
                    [tabId]: { ...session.tabs[tabId], agentState: beat.agentState },
                  }
                : session.tabs,
            }));
          }
        }, elapsed),
      );
    }
  }

  private update(sessionId: string, fn: (s: Session) => Session) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.set(sessionId, fn(session));
    this.notify();
  }

  private notify() {
    const list = this.list();
    for (const listener of this.listeners) listener(list);
  }

  private sessionOfTab(tabId: string): Session | undefined {
    return [...this.sessions.values()].find((s) => s.tabs[tabId]);
  }

  // ── SessionDriver ──────────────────────────────────────────────────────

  list(): Session[] {
    return [...this.sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  subscribe(handler: (s: Session[]) => void): Unsubscribe {
    this.listeners.add(handler);
    handler(this.list());
    return () => this.listeners.delete(handler);
  }

  attach(tabId: string, onData: DataHandler): Unsubscribe {
    const stream = this.stream(tabId);
    if (stream.buffer) onData(stream.buffer); // replay scrollback
    stream.listeners.add(onData);
    return () => stream.listeners.delete(onData);
  }

  write(tabId: string, data: string): void {
    const session = this.sessionOfTab(tabId);
    if (!session) return;

    // Echo like a PTY in canonical mode would, so typing feels real.
    this.emit(tabId, data === '\r' ? '\r\n' : data === '\x7f' ? '\b \b' : data);

    if (data === '\r' && session.tabs[tabId].agentState === 'waiting') {
      this.update(session.id, (s) => ({
        ...s,
        tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], agentState: 'working' } },
      }));
      this.play(session.id, tabId, [
        { after: 500, text: `\r\n  ${C.dim}Understood — routing both call sites.${C.reset}\r\n` },
        {
          after: 1400,
          text: `  ${C.green}✔${C.reset} Edit ${C.cyan}src/auth/session.ts${C.reset}  ${C.green}+34${C.reset} ${C.red}-12${C.reset}\r\n\r\n`,
          agentState: 'done',
          diff: { files: 1, added: 34, removed: 12 },
        },
        { after: 200, text: prompt(session.cwd) },
      ]);
    }
  }

  resize(_tabId: string, _cols: number, _rows: number): void {
    // A real driver sends SIGWINCH here. The mock has no process to notify.
  }

  interrupt(tabId: string): void {
    const session = this.sessionOfTab(tabId);
    if (!session) return;
    this.emit(tabId, `^C\r\n${C.dim}Interrupted.${C.reset}\r\n\r\n${prompt(session.cwd)}`);
    this.update(session.id, (s) => ({
      ...s,
      tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], agentState: undefined } },
    }));
  }

  createSession(options: CreateSessionOptions): Session {
    const tab = options.adopt ?? this.makeTab('terminal', { title: 'claude', agent: 'claude' });
    const session = this.makeSession(options.title, options.branch, [tab], 0);
    session.cwd = options.cwd;
    this.sessions.set(session.id, session);
    this.notify();
    if (!options.adopt) {
      this.play(session.id, tab.id, agentScript(options.cwd, options.title.toLowerCase(), [
        'src/session/pty.ts',
        'electron/main.ts',
      ]));
    }
    return session;
  }

  killSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    for (const tabId of Object.keys(session.tabs)) {
      const stream = this.streams.get(tabId);
      stream?.timers.forEach((t) => window.clearTimeout(t));
      this.streams.delete(tabId);
    }
    this.sessions.delete(sessionId);
    this.notify();
  }

  addTab(sessionId: string, groupId: string, kind: TabKind): Tab {
    const tab =
      kind === 'browser'
        ? this.makeTab('browser', { title: 'New tab', url: 'http://localhost:5173/' })
        : this.makeTab('terminal', { title: 'zsh' });

    this.update(sessionId, (session) => ({
      ...session,
      tabs: { ...session.tabs, [tab.id]: tab },
      groups: {
        ...session.groups,
        [groupId]: {
          ...session.groups[groupId],
          tabIds: [...session.groups[groupId].tabIds, tab.id],
          activeTabId: tab.id,
        },
      },
    }));

    const session = this.sessions.get(sessionId);
    if (kind === 'terminal' && session) {
      this.play(sessionId, tab.id, [{ after: 150, text: prompt(session.cwd) }]);
    }
    return tab;
  }

  closeTab(sessionId: string, tabId: string): void {
    this.streams.get(tabId)?.timers.forEach((t) => window.clearTimeout(t));
    this.streams.delete(tabId);

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
      const created = this.makeSession(tab.title, session.branch, [tab], 0);
      created.cwd = session.cwd;
      this.sessions.set(created.id, created);
      this.notify();
      return;
    }

    if (action.kind === 'tabbar') {
      const sameGroup = fromGroupId === action.groupId;
      const current = this.sessions.get(sessionId)!;
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
    const anchor = current.groups[action.groupId] ? action.groupId : Object.keys(current.groups)[0];

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
