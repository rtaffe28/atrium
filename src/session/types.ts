/**
 * The seam.
 *
 * Everything above this interface is UI and is written once. Everything below
 * it is platform-specific and gets implemented three times (or once, by a
 * library that already did the work).
 *
 * Today the only implementation is MockDriver. Later there will be a
 * NodePtyDriver that talks to real pseudo-terminals in the Electron main
 * process. The UI must never learn the difference.
 */

/** What an agent is doing right now. The rail exists to surface this. */
export type AgentState = 'working' | 'waiting' | 'done' | 'error';

/** A session's state is derived from its agent tabs — see deriveSessionState. */
export type SessionState = AgentState | 'idle';

export type TabKind = 'terminal' | 'browser';

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  /** Terminal tabs only. Absent means a plain shell, not an agent. */
  agent?: string;
  /**
   * What is running in this tab, captured live from the pty's foreground
   * process, and re-run when the workspace is restored.
   *
   * Without this, a tab where you typed `claude` by hand comes back as a bare
   * shell — the app has no record that anything was running, and you are left
   * hunting for the session you had.
   */
  command?: string;
  /**
   * A stable id for the agent conversation in this tab.
   *
   * Handed to Claude Code as --session-id the first time, and used to resume
   * exactly that conversation afterwards. Deciding the id up front is what
   * makes restore exact; discovering it later cannot distinguish two agents
   * working in the same directory.
   */
  agentSessionId?: string;
  /**
   * The Codex thread this tab owns.
   *
   * Observed rather than assigned: codex has no --session-id, so this appears
   * only after the tab has run codex once and written its rollout file.
   */
  codexSessionId?: string;
  /** Terminal tabs running an agent. Drives the rail and notifications. */
  agentState?: AgentState;
  /** Browser tabs only. */
  url?: string;
}

/** A pane: one tab bar and whichever of its tabs is active. */
export interface TabGroup {
  id: string;
  tabIds: string[];
  activeTabId: string | null;
}

/**
 * The split layout, as a binary tree.
 *
 * Leaves are tab groups. Dragging a tab to a pane's edge splits that leaf into
 * a branch; closing the last tab in a group collapses the branch back. This is
 * the VS Code / iTerm model and it is what makes "drag two tabs side by side"
 * fall out for free instead of being a special case.
 */
export type LayoutNode =
  | { type: 'leaf'; groupId: string }
  | {
      type: 'split';
      direction: 'row' | 'column';
      children: [LayoutNode, LayoutNode];
      /** Fractions of the parent, summing to 1. */
      sizes: [number, number];
    };

export interface DiffStat {
  files: number;
  added: number;
  removed: number;
}

export interface Session {
  id: string;
  title: string;
  cwd: string;
  branch: string;
  createdAt: number;
  diff: DiffStat;
  layout: LayoutNode;
  groups: Record<string, TabGroup>;
  tabs: Record<string, Tab>;
}

export interface CreateSessionOptions {
  title: string;
  cwd: string;
  branch: string;
  /** Command to run in the session's first tab. Blank means a plain shell. */
  command?: string;
  /**
   * A stable id for the agent conversation in this tab.
   *
   * Handed to Claude Code as --session-id the first time, and used to resume
   * exactly that conversation afterwards. Deciding the id up front is what
   * makes restore exact; discovering it later cannot distinguish two agents
   * working in the same directory.
   */
  agentSessionId?: string;
  /**
   * The Codex thread this tab owns.
   *
   * Observed rather than assigned: codex has no --session-id, so this appears
   * only after the tab has run codex once and written its rollout file.
   */
  codexSessionId?: string;
  /** Seed the session with this tab instead of a fresh agent terminal. */
  adopt?: Tab;
}

/** Bytes flowing out of a tab, as they would arrive from a PTY. */
export type DataHandler = (chunk: string) => void;
export type Unsubscribe = () => void;

/** Where a dragged tab landed. */
export type DropAction =
  | { kind: 'tabbar'; groupId: string; index: number }
  | { kind: 'split'; groupId: string; edge: 'left' | 'right' | 'top' | 'bottom' }
  | { kind: 'rail' };

export interface SessionDriver {
  list(): Session[];
  subscribe(handler: (sessions: Session[]) => void): Unsubscribe;

  /**
   * Attach to a terminal tab's output stream.
   *
   * Replays scrollback first, then streams live. A real driver would take a
   * sequence number so reattach after a disconnect is idempotent; the mock
   * replays everything because it can afford to.
   */
  attach(tabId: string, onData: DataHandler): Unsubscribe;

  /** Keystrokes headed for the process's stdin. */
  write(tabId: string, data: string): void;

  /** SIGWINCH on Unix, ResizePseudoConsole on Windows. */
  resize(tabId: string, cols: number, rows: number): void;

  /** SIGINT to the process group on Unix, 0x03 / CTRL_C_EVENT on Windows. */
  interrupt(tabId: string): void;

  createSession(options: CreateSessionOptions): Session;
  killSession(sessionId: string): void;

  addTab(sessionId: string, groupId: string, kind: TabKind): Tab;
  closeTab(sessionId: string, tabId: string): void;
  activateTab(sessionId: string, groupId: string, tabId: string): void;
  /** Change fields on a tab. One method rather than one per field. */
  patchTab(sessionId: string, tabId: string, patch: Partial<Tab>): void;

  /** The workspace shape, ready to serialise. */
  snapshot(): Session[];
  /** Per-tab terminal history, trimmed to the host's budget. */
  scrollback(budget: number): Record<string, string>;

  /** Resolve a completed tab drag. */
  moveTab(sessionId: string, tabId: string, action: DropAction): void;
  /** Persist a splitter drag. */
  setSizes(sessionId: string, path: number[], sizes: [number, number]): void;
}

/**
 * A session is as urgent as its most urgent agent tab.
 *
 * "Needs input" outranks everything: it is the only state where the human is
 * the bottleneck, so it must win the rail's attention.
 */
export function deriveSessionState(session: Session): SessionState {
  const states = Object.values(session.tabs)
    .map((t) => t.agentState)
    .filter((s): s is AgentState => s !== undefined);

  if (states.length === 0) return 'idle';
  if (states.includes('waiting')) return 'waiting';
  if (states.includes('working')) return 'working';
  if (states.includes('error')) return 'error';
  return 'done';
}
