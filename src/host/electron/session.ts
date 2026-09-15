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

  private bridge: AtriumBridge;
  private home: string;

  constructor(bridge: AtriumBridge, home: string, restore?: RestoreInput) {
    super();
    this.bridge = bridge;
    this.home = home;
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

  protected openTerminal(tabId: string, cwd: string, agent?: string): void {
    if (agent) this.agents.add(tabId);
    void this.bridge.pty.spawn({
      id: tabId,
      cwd: cwd.startsWith('~') ? cwd.replace('~', this.home) : cwd,
      cols: 80,
      rows: 24,
      ...(agent && agent !== 'shell' ? { shell: agent, args: [] } : {}),
    });
  }

  protected closeTerminal(tabId: string): void {
    const stream = this.streams.get(tabId);
    if (stream) window.clearTimeout(stream.settle);
    this.streams.delete(tabId);
    this.agents.delete(tabId);
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
    // A real PTY echoes; unlike the mock we must not echo ourselves.
    this.bridge.pty.write(tabId, data);
  }

  resize(tabId: string, cols: number, rows: number): void {
    this.bridge.pty.resize(tabId, cols, rows);
  }

  interrupt(tabId: string): void {
    this.bridge.pty.interrupt(tabId);
  }
}
