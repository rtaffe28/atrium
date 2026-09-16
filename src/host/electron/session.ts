import { SessionStore } from '../../session/store';
import type { AgentState, DataHandler, Unsubscribe } from '../../session/types';
import { newBellScan, scanForBell, type BellScan } from '../../session/bell';
import {
  newShellEventScan,
  scanShellEvents,
  type ShellEventScan,
} from '../../session/shellEvents';
import { sanitizeHistory } from '../../session/history';
import type { Session } from '../../session/types';
import type { AtriumBridge } from './bridge';

export interface RestoreInput {
  sessions: Session[];
  scrollback: Record<string, string>;
}

/** No output for this long after activity means the agent has stopped. */
const SETTLE_MS = 1500;

/**
 * What the hooks write, and what it means to the rail.
 *
 * `clear` removes the file rather than writing a state: a tab whose agent has
 * exited is not in any of these, it simply has no agent.
 */
const REPORTED_STATES: Record<string, AgentState | undefined> = {
  working: 'working',
  done: 'done',
  waiting: 'waiting',
};

/**
 * How long after a keystroke its echo may still be arriving.
 *
 * A pty echoes what is written to it, so typing produces output — and output
 * is the basis for "the agent is working". Without this, typing into a tab
 * made the agent look busy, and stopping typing rang the finished chime for
 * work nobody had started.
 *
 * This is not a guess about what the output means: we sent those bytes, so we
 * know. The only estimate is how long the round trip takes, and it only has to
 * outlast one keystroke's echo — a continuing typist keeps pushing the window
 * ahead of themselves.
 */
const ECHO_MS = 250;

/** How often to ask the ptys what is running in them. */
const POLL_MS = 2000;

/**
 * Home the cursor and clear the visible screen, between restored history and
 * the session about to start on top of it.
 *
 * Deliberately not `ESC[3J`, which would erase the scrollback too, and
 * deliberately not typing `clear` into the shell — that would land in shell
 * history and appear as a command the user did not run. The old session stays
 * scrollable above; the screen just does not open half-full of it.
 */
const CLEAR_VIEWPORT = '\x1b[H\x1b[2J';

/**
 * How long the shell must be quiet before a restored command is typed.
 *
 * Writing on the first byte is too early: the first chunk is often a partial
 * line or terminal setup, not a prompt, and characters sent then are mangled
 * or swallowed by a line editor that is not ready. Waiting for output to stop
 * is a far better proxy for "the shell is sitting at a prompt".
 */
const SHELL_SETTLE_MS = 350;

interface Stream {
  buffer: string;
  listeners: Set<DataHandler>;
  settle: number;
  /** Carried across chunks: a sequence can be split between two reads. */
  bell: BellScan;
  shell: ShellEventScan;
  /**
   * The agent rang and has not been answered.
   *
   * Latched rather than derived from the latest output, because an agent rings
   * the bell and *then* prints its question — so the next chunk would
   * immediately overwrite "needs you" with "working" and the state would never
   * survive long enough to be useful.
   */
  awaitingHuman: boolean;
  /**
   * When the user last typed something that was not a submission.
   *
   * Editing a line is not the agent working, and the echo of it is not the
   * agent's output. Submitting is a different matter, so it clears this.
   */
  typedAt: number;
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
  /** Tabs whose agent reports its own state, and so is never guessed at. */
  private reporting = new Set<string>();
  /** Commands waiting to be typed into a freshly spawned shell. */
  private autorun = new Map<string, { command: string; timer: number }>();
  /** When each tab's shell started, so a Codex thread can be matched to it. */
  private spawnedAt = new Map<string, number>();
  private poll = 0;

  private bridge: AtriumBridge;
  private home: string;

  private shellName: string;
  private stateRoot = '';

  constructor(
    bridge: AtriumBridge,
    home: string,
    shell: string,
    sessionState: string,
    restore?: RestoreInput,
  ) {
    super();
    this.bridge = bridge;
    this.home = home;
    this.shellName = shell.split('/').pop() ?? 'zsh';
    this.stateRoot = sessionState;
    this.bridge.pty.onData((tabId, data) => this.receive(tabId, data));
    this.bridge.pty.onExit((tabId) => {
      const stream = this.streams.get(tabId);
      if (stream) stream.awaitingHuman = false;
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
   * The pty's foreground process answers *whether* something is running — it
   * is how a terminal knows `vim` is open rather than a shell. It is a poor
   * answer to *what*, though, because a process can rename itself: Claude Code
   * reports as its own version number, so trusting the name recorded `2.1.273`
   * as the command and restore dutifully typed that into a shell.
   *
   * So the line the user actually submitted wins, and the process name is only
   * a fallback for a tab nobody typed in. That is also better for wrappers:
   * `npm run dev` is a more useful thing to restore than `node`.
   */
  /** Where the shim reports what this tab is running. */
  private stateDir(tabId: string): string {
    return `${this.stateRoot}/${tabId.replace(/[^\w-]/g, '')}`;
  }

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

        // Back at a prompt: whatever was reporting has gone, and the next
        // thing to run here may be something that cannot.
        if (running === this.shellName) {
          this.reporting.delete(tab.id);
          continue;
        }

        // What the agent has said about itself — which conversation it is on,
        // and what it is doing. Without it a tab keeps the placeholder id it
        // was born with, restore arms a resume for a conversation the agent
        // has never heard of, and you get a new one instead of the one you
        // left.
        void this.bridge.agent
          .report(tab.id)
          .then((report) => this.applyReport(tab.id, report))
          .catch(() => {});

        if (running !== 'codex' || tab.codexSessionId) continue;

        // Codex writes its thread id only after it starts, so this is the
        // first moment the tab can learn which conversation it owns.
        if (running === 'codex' && !tab.codexSessionId) {
          void this.bridge.agent
            .newestCodexSession(this.spawnedAt.get(tab.id) ?? 0)
            .then((codexSessionId) => {
              if (!codexSessionId) return;
              this.update(session.id, (s) => ({
                ...s,
                tabs: { ...s.tabs, [tab.id]: { ...s.tabs[tab.id], codexSessionId } },
              }));
            })
            .catch(() => {});
        }

      }
    }
  }

  protected primeScrollback(tabId: string, history: string): void {
    if (history) this.stream(tabId).buffer = `${history}${CLEAR_VIEWPORT}`;
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
      stream = {
        buffer: '',
        listeners: new Set(),
        settle: 0,
        bell: newBellScan(),
        shell: newShellEventScan(),
        awaitingHuman: false,
        typedAt: 0,
      };
      this.streams.set(tabId, stream);
    }
    return stream;
  }

  private receive(tabId: string, data: string) {
    const stream = this.stream(tabId);

    // Restart the settle clock on every chunk; the command goes in once the
    // shell has finished printing its prompt.
    const queued = this.autorun.get(tabId);
    if (queued) {
      window.clearTimeout(queued.timer);
      queued.timer = window.setTimeout(() => {
        this.autorun.delete(tabId);
        this.bridge.pty.write(tabId, `${queued.command}\r`);
      }, SHELL_SETTLE_MS);
    }

    stream.buffer += data;
    for (const listener of stream.listeners) listener(data);

    const reported = this.applyShellEvents(tabId, data, stream);

    if (!this.agents.has(tabId)) return;

    // This tab's agent says what it is doing. Nothing below this line is
    // better than that, and everything below it can contradict it.
    if (this.reporting.has(tabId)) return;

    if (scanForBell(data, stream.bell)) {
      stream.awaitingHuman = true;
      this.setAgentState(tabId, 'waiting');
      window.clearTimeout(stream.settle);
      return;
    }

    // Output after the bell is the agent explaining what it wants; it is not
    // evidence that the agent stopped waiting. Only the human is.
    if (stream.awaitingHuman) return;

    // Our own keystrokes coming back. Leaving the state and the settle clock
    // alone is the point: typing should neither start the agent working nor
    // postpone the moment it is reported as finished.
    if (stream.typedAt && Date.now() - stream.typedAt < ECHO_MS) return;

    // The same chunk carried the shell reporting how the command ended, and
    // the chunk is also, unavoidably, output. Inferring "working" from it
    // would overwrite a fact with a guess a line later, and the guess would
    // then settle to "done" — so a failed command reported itself correctly
    // and was announced as a success 1.5 seconds afterwards.
    if (reported) return;

    // Working and done are inferred from whether bytes are arriving, which is
    // a weaker thing than it looks — see docs/plan/active/12-agent-state.md.
    this.setAgentState(tabId, 'working');
    window.clearTimeout(stream.settle);
    stream.settle = window.setTimeout(() => this.setAgentState(tabId, 'done'), SETTLE_MS);
  }

  /**
   * What the shell reports, which beats anything we could infer.
   *
   * The foreground process name lies when a process renames itself, and a
   * command reassembled from keystrokes is invalidated by a single control
   * character. Both produced wrong answers in practice. A shell that speaks
   * the integration protocol simply says what it ran and how it ended.
   */
  private applyShellEvents(tabId: string, data: string, stream: Stream): boolean {
    const session = this.sessionOfTab(tabId);
    if (!session) return false;

    let reported = false;

    for (const event of scanShellEvents(data, stream.shell)) {
      if (event.type === 'started' && event.command) {
        const command = event.command.trim();
        if (!command) continue;
        this.update(session.id, (s) => ({
          ...s,
          tabs: {
            ...s.tabs,
            [tabId]: { ...s.tabs[tabId], command, title: command.split(/\s+/)[0] },
          },
        }));
        continue;
      }

      if (event.type === 'cwd') {
        // Arrives on every prompt, so the guard is what keeps a prompt from
        // being a workspace write.
        if (session.tabs[tabId]?.cwd !== event.cwd) {
          this.update(session.id, (s) => ({
            ...s,
            tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], cwd: event.cwd } },
          }));
        }
        continue;
      }

      if (event.type === 'finished' || event.type === 'prompt') {
        // The command is kept — it is what this tab was last doing, and the
        // only thing a restore has to go on. Only the title returns to idle.
        this.update(session.id, (s) =>
          s.tabs[tabId]?.title === this.shellName
            ? s
            : { ...s, tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], title: this.shellName } } },
        );
        if (event.type === 'finished' && this.agents.has(tabId)) {
          // Reported by the shell, so this one is a fact: the command the tab
          // was running has exited, with this status. It beats the settle
          // clock, which is only ever a guess about the same thing.
          window.clearTimeout(stream.settle);
          reported = true;
          if (!stream.awaitingHuman) {
            this.setAgentState(tabId, event.exitCode === 0 ? 'done' : 'error');
          }
        }
      }
    }

    return reported;
  }

  /**
   * Take the agent at its word.
   *
   * A reported status is not a better guess than the settle clock — it is a
   * different kind of thing. Once a tab has produced one, the inference stops
   * for that tab entirely: two answers to one question is how the rail came to
   * flicker between "working" and "needs you" in the first place.
   */
  private applyReport(
    tabId: string,
    { sessionId, status }: { sessionId: string | null; status: string | null },
  ): void {
    const session = this.sessionOfTab(tabId);
    if (!session) return;

    if (sessionId && session.tabs[tabId]?.agentSessionId !== sessionId) {
      this.update(session.id, (s) => ({
        ...s,
        tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], agentSessionId: sessionId } },
      }));
    }

    const reported = REPORTED_STATES[status ?? ''];
    if (!reported) return;
    this.reporting.add(tabId);
    window.clearTimeout(this.stream(tabId).settle);
    this.setAgentState(tabId, reported);
  }

  private setAgentState(tabId: string, state: AgentState | undefined) {
    const session = this.sessionOfTab(tabId);
    if (!session || session.tabs[tabId]?.agentState === state) return;
    this.update(session.id, (s) => ({
      ...s,
      tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], agentState: state } },
    }));
  }

  protected openTerminal(
    tabId: string,
    cwd: string,
    command?: string,
    restoring = false,
  ): void {
    const wanted = command?.trim();
    if (wanted) this.agents.add(tabId);

    const tab = this.sessionOfTab(tabId)?.tabs[tabId];
    // Arm a resume only when the tab is being restored. The shim consumes the
    // marker on the next agent run and does not replace it, so exiting an agent
    // and starting it again gives a new conversation rather than the old one.
    void this.bridge.agent.prepareSession(
      tabId,
      restoring ? { claude: tab?.agentSessionId, codex: tab?.codexSessionId } : {},
      cwd.startsWith('~') ? cwd.replace('~', this.home) : cwd,
    );

    // Always spawn the shell, then type the command into it. Replacing the
    // shell would mean the tab vanishes the moment the command exits, and it
    // would lose quoting and arguments that the shell parses for free.
    void this.bridge.pty.spawn({
      id: tabId,
      cwd: cwd.startsWith('~') ? cwd.replace('~', this.home) : cwd,
      cols: 80,
      rows: 24,
      env: { ATRIUM_SESSION_STATE: this.stateDir(tabId) },
    });
    this.spawnedAt.set(tabId, Date.now());

    if (wanted && wanted !== this.shellName) {
      // Queued straight away so a fast-starting shell is never typed into
      // before there is anything to type, then rewritten once the main process
      // says whether this conversation already exists.
      this.autorun.set(tabId, { command: wanted, timer: 0 });
    }
  }

  protected closeTerminal(tabId: string): void {
    const stream = this.streams.get(tabId);
    if (stream) window.clearTimeout(stream.settle);
    const queued = this.autorun.get(tabId);
    if (queued) window.clearTimeout(queued.timer);
    this.streams.delete(tabId);
    this.agents.delete(tabId);
    this.reporting.delete(tabId);
    this.autorun.delete(tabId);
    this.spawnedAt.delete(tabId);
    this.bridge.pty.kill(tabId);
  }

  attach(tabId: string, onData: DataHandler): Unsubscribe {
    const stream = this.stream(tabId);
    stream.listeners.add(onData);

    if (stream.buffer) {
      // Whatever we already hold — restored scrollback, or output received
      // earlier this run — is the complete history. Sanitised, because raw
      // replay re-answers terminal queries and re-arms modes; see history.ts.
      onData(sanitizeHistory(stream.buffer));
    } else {
      // Nothing locally: this window reloaded and the main process still has
      // the buffer for a pty that never stopped.
      void this.bridge.pty.replay(tabId).then((history) => {
        if (history && stream.listeners.has(onData)) {
          stream.buffer = history;
          onData(sanitizeHistory(history));
        }
      });
    }

    return () => stream.listeners.delete(onData);
  }

  write(tabId: string, data: string): void {
    const stream = this.stream(tabId);

    // Submitting is the answer the agent was waiting for. Typing towards one
    // is not: a tab that flips to "working" on the first character claims the
    // agent is busy with a line the user has not finished writing, and it
    // stops saying "needs you" while that is still the only true thing about
    // it.
    if (/[\r\n]/.test(data)) {
      stream.typedAt = 0;
      if (stream.awaitingHuman) {
        stream.awaitingHuman = false;
        this.setAgentState(tabId, 'working');
      }
    } else {
      stream.typedAt = Date.now();
    }

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
