import { SessionStore } from '../../session/store';
import type { AgentState, DataHandler, Unsubscribe } from '../../session/types';
import type { Session } from '../../session/types';
import type { AtriumBridge } from './bridge';

export interface RestoreInput {
  sessions: Session[];
  scrollback: Record<string, string>;
}

/** No output for this long after activity means the agent has stopped. */
const SETTLE_MS = 1500;

/** How often to ask the ptys what is running in them. */
const POLL_MS = 2000;

interface Stream {
  buffer: string;
  listeners: Set<DataHandler>;
  settle: number;
}

/**
 * Sessions backed by real pseudo-terminals in the main process.
 *
 * All the session, tab and layout logic comes from SessionStore — none of it
 * cares whether a terminal is real. This class supplies only the terminal.
 *
 * ## How agent state is inferred
 *
 * A PTY gives bytes, not status, so state is read from the byte stream:
 *
 *   - **BEL** (0x07) means waiting. That is not a guess: ringing the terminal
 *     bell is the long-standing convention for "I need the human", and coding
 *     agents follow it.
 *   - **Output arriving** means working.
 *   - **Quiet after working** means done.
 *
 * Only tabs that were opened as agents get a state at all; a plain shell stays
 * blank rather than claiming to be "done" while sitting at a prompt. This is
 * a heuristic and it is worth replacing with something the agent reports
 * explicitly — an OSC sequence would do it — but it is honest about what the
 * bytes actually say.
 */
export class ElectronSessionDriver extends SessionStore {
  private streams = new Map<string, Stream>();
  private agents = new Set<string>();
  /** Characters typed since the last Enter, so we can recover a full command. */
  private typing = new Map<string, string>();
  /** The last line submitted in each tab — the command with its arguments. */
  private submitted = new Map<string, string>();
  /** Commands waiting to be typed into a freshly spawned shell. */
  private autorun = new Map<string, string>();
  private poll = 0;

  private bridge: AtriumBridge;
  private home: string;

  private shellName: string;

  constructor(bridge: AtriumBridge, home: string, shell: string, restore?: RestoreInput) {
    super();
    this.bridge = bridge;
    this.home = home;
    this.shellName = shell.split('/').pop() ?? 'zsh';
    this.bridge.pty.onData((tabId, data) => this.receive(tabId, data));
    this.bridge.pty.onExit((tabId) => {
      this.setAgentState(tabId, undefined);
      this.agents.delete(tabId);
    });

    if (restore && restore.sessions.length > 0) {
      this.hydrate(restore.sessions, restore.scrollback);
    } else {
      this.seed();
    }

    this.poll = window.setInterval(() => void this.refreshCommands(), POLL_MS);
    // A reload tears down the renderer but not the ptys; stop asking them
    // things from a document that is on its way out.
    window.addEventListener('beforeunload', () => this.dispose());
  }

  dispose(): void {
    window.clearInterval(this.poll);
  }

  /**
   * Record what is actually running in each tab.
   *
   * The pty's foreground process is the truth — it is how a terminal knows
   * `vim` is open rather than a shell. But it gives a bare name, so when the
   * last line typed starts with that name we keep the whole line, arguments
   * included: re-running `claude --continue` is the point, and `claude` alone
   * would start a fresh conversation.
   */
  async refreshCommands(): Promise<void> {
    let foreground: Record<string, string>;
    try {
      foreground = await this.bridge.pty.foreground();
    } catch {
      return;
    }

    for (const session of this.list()) {
      for (const tab of Object.values(session.tabs)) {
        if (tab.kind !== 'terminal') continue;

        const running = foreground[tab.id];
        if (!running) continue;

        const idle = running === this.shellName;
        const line = this.submitted.get(tab.id) ?? '';
        const command = idle
          ? undefined
          : line.split(/\s+/)[0] === running
            ? line
            : running;
        const title = idle ? this.shellName : running;

        if (tab.command === command && tab.title === title) continue;
        this.update(session.id, (s) => ({
          ...s,
          tabs: { ...s.tabs, [tab.id]: { ...s.tabs[tab.id], command, title } },
        }));
      }
    }
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

  private seed() {
    const tab = this.makeTab('terminal', { title: 'zsh' });
    const session = this.makeSession('Shell', 'main', [tab], 0, this.home);
    this.sessions.set(session.id, session);
    this.notify();
    this.openTerminal(tab.id, this.home);
  }

  private stream(tabId: string): Stream {
    let stream = this.streams.get(tabId);
    if (!stream) {
      stream = { buffer: '', listeners: new Set(), settle: 0 };
      this.streams.set(tabId, stream);
    }
    return stream;
  }

  private receive(tabId: string, data: string) {
    const stream = this.stream(tabId);

    // The shell is up once it has said anything; now it can be typed into.
    const queued = this.autorun.get(tabId);
    if (queued) {
      this.autorun.delete(tabId);
      this.submitted.set(tabId, queued);
      this.bridge.pty.write(tabId, `${queued}\r`);
    }

    stream.buffer += data;
    for (const listener of stream.listeners) listener(data);

    if (!this.agents.has(tabId)) return;

    if (data.includes('\x07')) {
      this.setAgentState(tabId, 'waiting');
      window.clearTimeout(stream.settle);
      return;
    }

    this.setAgentState(tabId, 'working');
    window.clearTimeout(stream.settle);
    stream.settle = window.setTimeout(() => this.setAgentState(tabId, 'done'), SETTLE_MS);
  }

  private setAgentState(tabId: string, state: AgentState | undefined) {
    const session = this.sessionOfTab(tabId);
    if (!session || session.tabs[tabId]?.agentState === state) return;
    this.update(session.id, (s) => ({
      ...s,
      tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], agentState: state } },
    }));
  }

  protected openTerminal(tabId: string, cwd: string, command?: string): void {
    const wanted = command?.trim();
    if (wanted) this.agents.add(tabId);

    // Always spawn the shell, then type the command into it. Replacing the
    // shell would mean the tab vanishes the moment the command exits, and it
    // would lose quoting and arguments that the shell parses for free.
    void this.bridge.pty.spawn({
      id: tabId,
      cwd: cwd.startsWith('~') ? cwd.replace('~', this.home) : cwd,
      cols: 80,
      rows: 24,
    });

    if (wanted && wanted !== this.shellName) this.autorun.set(tabId, wanted);
  }

  protected closeTerminal(tabId: string): void {
    const stream = this.streams.get(tabId);
    if (stream) window.clearTimeout(stream.settle);
    this.streams.delete(tabId);
    this.agents.delete(tabId);
    this.typing.delete(tabId);
    this.submitted.delete(tabId);
    this.autorun.delete(tabId);
    this.bridge.pty.kill(tabId);
  }

  attach(tabId: string, onData: DataHandler): Unsubscribe {
    const stream = this.stream(tabId);
    stream.listeners.add(onData);

    if (stream.buffer) {
      // Whatever we already hold — restored scrollback, or output received
      // earlier this run — is the complete history.
      onData(stream.buffer);
    } else {
      // Nothing locally: this window reloaded and the main process still has
      // the buffer for a pty that never stopped.
      void this.bridge.pty.replay(tabId).then((history) => {
        if (history && stream.listeners.has(onData)) {
          stream.buffer = history;
          onData(history);
        }
      });
    }

    return () => stream.listeners.delete(onData);
  }

  write(tabId: string, data: string): void {
    this.captureTyping(tabId, data);
    // A real PTY echoes; unlike the mock we must not echo ourselves.
    this.bridge.pty.write(tabId, data);
  }

  /** Reassemble the line being typed, so a submitted command keeps its args. */
  private captureTyping(tabId: string, data: string): void {
    let buffer = this.typing.get(tabId) ?? '';
    for (const char of data) {
      if (char === '\r' || char === '\n') {
        const line = buffer.trim();
        if (line) this.submitted.set(tabId, line);
        buffer = '';
      } else if (char === '\x7f' || char === '\b') {
        buffer = buffer.slice(0, -1);
      } else if (char >= ' ') {
        buffer += char;
      } else {
        // Control characters mean something interactive is happening; whatever
        // was half-typed is not a command line.
        buffer = '';
      }
    }
    this.typing.set(tabId, buffer);
  }

  resize(tabId: string, cols: number, rows: number): void {
    this.bridge.pty.resize(tabId, cols, rows);
  }

  interrupt(tabId: string): void {
    this.bridge.pty.interrupt(tabId);
  }
}
