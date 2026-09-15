import type {
  CreateSessionOptions,
  DataHandler,
  SessionDriver,
  SessionMeta,
  SessionStatus,
  Unsubscribe,
} from './types';

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
} as const;

/** A scripted line of output: wait `after` ms, then emit `text`. */
interface Beat {
  after: number;
  text: string;
  status?: SessionStatus;
  diff?: { files: number; added: number; removed: number };
}

const prompt = (cwd: string) =>
  `${C.dim}${cwd}${C.reset} ${C.green}❯${C.reset} `;

function agentScript(cwd: string, task: string, files: string[]): Beat[] {
  const beats: Beat[] = [
    { after: 300, text: `${prompt(cwd)}claude "${task}"\r\n\r\n` },
    {
      after: 700,
      text: `${C.magenta}✻${C.reset} ${C.bold}Atrium${C.reset} ${C.dim}· Opus 5${C.reset}\r\n\r\n`,
      status: 'running',
    },
    { after: 900, text: `  ${C.dim}Reading the surrounding code…${C.reset}\r\n` },
  ];

  let added = 0;
  let removed = 0;
  files.forEach((f, i) => {
    const a = 12 + i * 19;
    const r = 3 + i * 4;
    added += a;
    removed += r;
    beats.push({
      after: 1100 + i * 200,
      text:
        `  ${C.green}✔${C.reset} Edit ${C.cyan}${f}${C.reset}  ` +
        `${C.green}+${a}${C.reset} ${C.red}-${r}${C.reset}\r\n`,
      diff: { files: i + 1, added, removed },
    });
  });

  beats.push(
    { after: 1200, text: `\r\n  ${C.dim}Running tests…${C.reset}\r\n` },
    {
      after: 1800,
      text: `  ${C.green}✔${C.reset} ${C.dim}47 passed, 0 failed${C.reset}\r\n\r\n`,
    },
    {
      after: 600,
      text: `${C.bold}Done.${C.reset} ${task} — ${files.length} files touched.\r\n\r\n`,
      status: 'done',
    },
    { after: 200, text: prompt(cwd) },
  );

  return beats;
}

function waitingScript(cwd: string): Beat[] {
  return [
    { after: 300, text: `${prompt(cwd)}claude "migrate the auth flow"\r\n\r\n` },
    {
      after: 800,
      text: `${C.magenta}✻${C.reset} ${C.bold}Atrium${C.reset} ${C.dim}· Opus 5${C.reset}\r\n\r\n`,
      status: 'running',
    },
    { after: 900, text: `  ${C.dim}Tracing the current session handling…${C.reset}\r\n` },
    {
      after: 1400,
      text:
        `  ${C.yellow}?${C.reset} Two call sites set the cookie directly.\r\n` +
        `    Should I route both through ${C.cyan}createSession()${C.reset}, or\r\n` +
        `    leave the legacy admin path alone?\r\n\r\n` +
        `  ${C.dim}[1]${C.reset} Route both  ${C.dim}[2]${C.reset} Leave admin  ${C.dim}[3]${C.reset} Explain\r\n\r\n` +
        `  ${C.yellow}❯${C.reset} `,
      status: 'waiting',
    },
  ];
}

function errorScript(cwd: string): Beat[] {
  return [
    { after: 300, text: `${prompt(cwd)}npm run build\r\n\r\n`, status: 'running' },
    { after: 900, text: `${C.dim}vite v7.1.0 building for production…${C.reset}\r\n` },
    { after: 1100, text: `${C.dim}transforming (218)…${C.reset}\r\n` },
    {
      after: 1200,
      text:
        `\r\n${C.red}✘ [ERROR]${C.reset} Could not resolve ${C.cyan}"./session/pty"${C.reset}\r\n\r\n` +
        `    ${C.dim}src/session/index.ts:4:24${C.reset}\r\n` +
        `      ${C.dim}4 │${C.reset} export { PtyDriver } from ${C.green}'./session/pty'${C.reset}\r\n` +
        `        ${C.dim}│${C.reset}                          ${C.red}~~~~~~~~~~~~~~~${C.reset}\r\n\r\n` +
        `${C.red}error${C.reset} Build failed with 1 error.\r\n\r\n`,
      status: 'error',
    },
    { after: 200, text: prompt(cwd) },
  ];
}

const SEED: Array<{ meta: Omit<SessionMeta, 'diff' | 'status'>; script: Beat[] }> = [
  {
    meta: {
      id: 's1',
      title: 'Session rail + status dots',
      agent: 'claude',
      cwd: '~/git/atrium',
      branch: 'ryan/session-rail',
      createdAt: Date.now() - 1000 * 60 * 14,
    },
    script: agentScript('~/git/atrium', 'build the session rail', [
      'src/components/Sidebar.tsx',
      'src/index.css',
      'src/App.tsx',
    ]),
  },
  {
    meta: {
      id: 's2',
      title: 'Auth flow migration',
      agent: 'claude',
      cwd: '~/git/atrium',
      branch: 'ryan/auth-migration',
      createdAt: Date.now() - 1000 * 60 * 6,
    },
    script: waitingScript('~/git/atrium'),
  },
  {
    meta: {
      id: 's3',
      title: 'Production build',
      agent: 'shell',
      cwd: '~/git/atrium',
      branch: 'main',
      createdAt: Date.now() - 1000 * 60 * 3,
    },
    script: errorScript('~/git/atrium'),
  },
  {
    meta: {
      id: 's4',
      title: 'xterm WebGL renderer spike',
      agent: 'claude',
      cwd: '~/git/atrium',
      branch: 'ryan/webgl-spike',
      createdAt: Date.now() - 1000 * 60 * 31,
    },
    script: agentScript('~/git/atrium', 'try the WebGL addon', [
      'src/components/TerminalView.tsx',
      'package.json',
    ]),
  },
];

interface MockSession {
  meta: SessionMeta;
  /** Everything emitted so far — the scrollback a real driver would ring-buffer. */
  buffer: string;
  listeners: Set<DataHandler>;
  timers: number[];
}

/**
 * A SessionDriver that never touches a process.
 *
 * Output is a pre-written script played back on timers, which is enough to
 * design against: real text, real ANSI colors, real status transitions, and
 * sessions that finish at different times so the rail actually moves.
 */
export class MockDriver implements SessionDriver {
  private sessions = new Map<string, MockSession>();
  private metaListeners = new Set<(s: SessionMeta[]) => void>();
  private nextId = 100;

  constructor() {
    for (const { meta, script } of SEED) {
      const session: MockSession = {
        meta: { ...meta, status: 'idle', diff: { files: 0, added: 0, removed: 0 } },
        buffer: '',
        listeners: new Set(),
        timers: [],
      };
      this.sessions.set(meta.id, session);
      this.play(session, script);
    }
  }

  private play(session: MockSession, script: Beat[]) {
    let elapsed = 0;
    for (const beat of script) {
      elapsed += beat.after;
      const timer = window.setTimeout(() => {
        session.buffer += beat.text;
        for (const listener of session.listeners) listener(beat.text);

        if (beat.status || beat.diff) {
          session.meta = {
            ...session.meta,
            ...(beat.status ? { status: beat.status } : {}),
            ...(beat.diff ? { diff: beat.diff } : {}),
          };
          this.emitMeta();
        }
      }, elapsed);
      session.timers.push(timer);
    }
  }

  private emitMeta() {
    const list = this.list();
    for (const listener of this.metaListeners) listener(list);
  }

  list(): SessionMeta[] {
    return [...this.sessions.values()]
      .map((s) => s.meta)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  subscribe(handler: (s: SessionMeta[]) => void): Unsubscribe {
    this.metaListeners.add(handler);
    handler(this.list());
    return () => this.metaListeners.delete(handler);
  }

  attach(id: string, onData: DataHandler): Unsubscribe {
    const session = this.sessions.get(id);
    if (!session) return () => {};
    if (session.buffer) onData(session.buffer); // replay scrollback
    session.listeners.add(onData);
    return () => session.listeners.delete(onData);
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    // Echo like a PTY in canonical mode would, so typing feels real.
    const echo = data === '\r' ? '\r\n' : data === '\x7f' ? '\b \b' : data;
    session.buffer += echo;
    for (const listener of session.listeners) listener(echo);

    if (data === '\r' && session.meta.status === 'waiting') {
      session.meta = { ...session.meta, status: 'running' };
      this.emitMeta();
      this.play(session, [
        { after: 500, text: `\r\n  ${C.dim}Understood — routing both call sites.${C.reset}\r\n` },
        {
          after: 900,
          text: `  ${C.green}✔${C.reset} Edit ${C.cyan}src/auth/session.ts${C.reset}  ${C.green}+34${C.reset} ${C.red}-12${C.reset}\r\n\r\n`,
          status: 'done',
          diff: { files: 1, added: 34, removed: 12 },
        },
        { after: 200, text: prompt(session.meta.cwd) },
      ]);
    }
  }

  resize(_id: string, _cols: number, _rows: number): void {
    // A real driver sends SIGWINCH here. The mock has no process to notify.
  }

  interrupt(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    const text = `^C\r\n${C.dim}Interrupted.${C.reset}\r\n\r\n${prompt(session.meta.cwd)}`;
    session.buffer += text;
    for (const listener of session.listeners) listener(text);
    session.meta = { ...session.meta, status: 'idle' };
    this.emitMeta();
  }

  kill(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    for (const timer of session.timers) window.clearTimeout(timer);
    this.sessions.delete(id);
    this.emitMeta();
  }

  async create(options: CreateSessionOptions): Promise<SessionMeta> {
    const id = `s${this.nextId++}`;
    const meta: SessionMeta = {
      id,
      ...options,
      status: 'idle',
      createdAt: Date.now(),
      diff: { files: 0, added: 0, removed: 0 },
    };
    const session: MockSession = { meta, buffer: '', listeners: new Set(), timers: [] };
    this.sessions.set(id, session);
    this.emitMeta();
    this.play(
      session,
      agentScript(options.cwd, options.title.toLowerCase(), [
        'src/session/pty.ts',
        'electron/main.ts',
      ]),
    );
    return meta;
  }
}
