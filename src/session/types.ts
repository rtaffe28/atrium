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

import type { Progress } from './signals';

export type TabKind = 'terminal' | 'browser' | 'file';

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
  /**
   * Where this terminal is now, as the shell reports it on every prompt.
   *
   * The session's own cwd is where it was opened, which stops being true the
   * first time you cd. A new session inherits from here.
   */
  cwd?: string;
  /** Browser tabs only. */
  url?: string;
  /**
   * File tabs only. Absolute, or under `~`. Absent in a folder tab until a
   * file is chosen from its tree.
   */
  path?: string;
  /** A folder whose tree is shown beside the file. Absent means no tree. */
  root?: string;
  /** A line to land on, from `path:12` or a link. Describes one opening only. */
  line?: number;

  // What the program in the tab has asked the terminal to show. Shown as it
  // was sent and never inferred; none of it outlives the run — see signals.ts.

  /** The last OSC 9;4 progress report, until it is taken away. */
  progress?: Progress;
  /** Rang the bell or posted a notification since you last looked at it. */
  attention?: boolean;
  /** The title the program set with OSC 0 or 2, until it exits. */
  programTitle?: string;
}

/**
 * The tab fields that describe this run only: what a program set, and the
 * line a file tab was asked to land on.
 */
export const TRANSIENT_TAB_FIELDS = ['progress', 'attention', 'programTitle', 'line'] as const;

/**
 * Something a tab you are not looking at wants you to know.
 *
 * `bell` and `notify` are requests the program made. `finished` is the tab
 * going from working to not — see SessionStore.trackWorking().
 */
export type Alert =
  | { type: 'bell' }
  | { type: 'notify'; title: string; body: string }
  | { type: 'finished' };

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
  /**
   * What the rail calls this session.
   *
   * Until the user names it, it is whatever the program working in it calls
   * itself — Claude's name for the conversation, read from the title it
   * sets — and follows that as it changes. See SessionStore.nameSession().
   */
  title: string;
  /**
   * The user typed the title. Programs stop naming the session from then on;
   * a name someone chose is not to be replaced by one a program came up with.
   */
  named?: boolean;
  /**
   * The tab whose program the title was copied from, until the user names
   * the session. It keeps the name while its program has a title, so two
   * agents in one session do not rename it to and fro — see
   * SessionStore.nameSession().
   */
  namedBy?: string;
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

/** Where a dragged session landed: its place on the rail, among the others. */
export type RailOrder = { kind: 'order'; index: number };

/** What a file tab is opened on: a file, or a folder whose tree is shown. */
export type FileTarget =
  | { kind: 'file'; path: string; line?: number }
  | { kind: 'folder'; root: string };

/**
 * What a program in a tab asked Atrium to do, through the `atrium` command.
 *
 * A closed set, each checked by the host before it gets here: a URL is one,
 * a path is a file or a folder that exists. Nothing flows back to the program.
 */
export type AgentRequest = { verb: 'open'; url: string } | { verb: 'open'; target: FileTarget };

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
  /**
   * Give a session a new title, and keep it: a session the user has named is
   * no longer named by its programs. Blank is ignored.
   */
  renameSession(sessionId: string, title: string): void;

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
  /**
   * Put a session at `index` on the rail, counted among the other sessions.
   * New sessions go to the top; this is the only way they leave it.
   */
  moveSession(sessionId: string, index: number): void;
  /** Persist a splitter drag. */
  setSizes(sessionId: string, path: number[], sizes: [number, number]): void;
  /**
   * Open `url` in a browser tab beside the pane holding `groupId`.
   *
   * What a Cmd- or Ctrl-click on a link does. Lands in the pane to the right
   * when there is exactly one, and splits one off when there is not.
   */
  openLinkBeside(sessionId: string, groupId: string, url: string): void;
  /**
   * Open a file or folder in a tab beside the pane holding `groupId`, where
   * openLinkBeside puts a link. One already open in the session is raised
   * rather than opened twice.
   */
  openFileBeside(sessionId: string, groupId: string, target: FileTarget): void;
  /** Open a file or folder in the pane holding `groupId` itself. */
  openFileIn(sessionId: string, groupId: string, target: FileTarget): Tab | null;
  /** Show another file in a file tab, keeping its tree. */
  showFile(sessionId: string, tabId: string, path: string, line?: number): void;

  /**
   * The tab you are looking at: the active tab of the focused pane, in a
   * focused window. Null when the window is in the background.
   *
   * A terminal does not alert for the tab in front of you, and looking at a
   * tab is what clears its mark.
   */
  setFocusedTab(tabId: string | null): void;
  /** A tab rang or posted a notification while you were looking elsewhere. */
  onAlert(handler: (tabId: string, alert: Alert) => void): Unsubscribe;
}
