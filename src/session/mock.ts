import { SessionStore } from './store';
import type { AgentState, DataHandler, Unsubscribe } from './types';

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

/**
 * A SessionDriver that never touches a process.
 *
 * Output is a pre-written script played back on timers, which is enough to
 * design against: real text, real ANSI colours, real status transitions, and
 * sessions that finish at different times so the rail actually moves.
 */
export class MockDriver extends SessionStore {
  private streams = new Map<string, Stream>();

  constructor() {
    super();
    this.seed();
  }

  private seed() {
    const cwd = '~/git/atrium';

    const a1 = this.makeTab('terminal', { title: 'claude', agent: 'claude' });
    const a2 = this.makeTab('terminal', { title: 'dev server' });
    const s1 = this.makeSession('Session rail + status dots', 'ryan/session-rail', [a1, a2], 14, cwd);

    const b1 = this.makeTab('terminal', { title: 'claude', agent: 'claude' });
    const b2 = this.makeTab('browser', { title: 'Preview', url: 'http://localhost:5173/' });
    const s2 = this.makeSession('Auth flow migration', 'ryan/auth-migration', [b1, b2], 6, cwd);

    const c1 = this.makeTab('terminal', { title: 'build', agent: 'shell' });
    const s3 = this.makeSession('Production build', 'main', [c1], 3, cwd);

    const d1 = this.makeTab('terminal', { title: 'claude', agent: 'claude' });
    const s4 = this.makeSession('WebGL renderer spike', 'ryan/webgl-spike', [d1], 31, cwd);

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

  protected openTerminal(tabId: string, cwd: string, agent?: string): void {
    if (agent) {
      const session = this.sessionOfTab(tabId);
      this.play(session?.id ?? '', tabId, agentScript(cwd, 'new session', [
        'src/session/pty.ts',
        'electron/main.ts',
      ]));
      return;
    }
    this.play('', tabId, [{ after: 150, text: prompt(cwd) }]);
  }

  protected primeScrollback(tabId: string, history: string): void {
    if (history) this.stream(tabId).buffer = history;
  }

  scrollback(budget: number): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [tabId, stream] of this.streams) {
      if (stream.buffer) out[tabId] = stream.buffer.slice(-budget);
    }
    return out;
  }

  protected closeTerminal(tabId: string): void {
    this.streams.get(tabId)?.timers.forEach((t) => window.clearTimeout(t));
    this.streams.delete(tabId);
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
}
