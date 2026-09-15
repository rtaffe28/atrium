/**
 * The seam.
 *
 * Everything above this interface is UI and is written once. Everything below
 * it is platform-specific and gets implemented three times (or once, by a
 * library that already did the work).
 *
 * Today the only implementation is MockDriver. Later there will be a
 * NodePtyDriver that talks to a real pseudo-terminal in the Electron main
 * process. The UI must never learn the difference.
 */

export type SessionStatus =
  | 'idle'     // process alive, nothing happening
  | 'running'  // agent is working
  | 'waiting'  // agent asked a question, needs the human
  | 'done'     // finished cleanly
  | 'error';   // exited non-zero

export interface DiffStat {
  files: number;
  added: number;
  removed: number;
}

export interface SessionMeta {
  id: string;
  title: string;
  agent: string;      // 'claude' | 'codex' | 'shell'
  cwd: string;        // absolute path to the worktree
  branch: string;
  status: SessionStatus;
  createdAt: number;
  diff: DiffStat;
}

export interface CreateSessionOptions {
  title: string;
  agent: string;
  cwd: string;
  branch: string;
}

/** Bytes flowing out of a session, as they would arrive from a PTY. */
export type DataHandler = (chunk: string) => void;
export type Unsubscribe = () => void;

export interface SessionDriver {
  /** Current metadata for every session. */
  list(): SessionMeta[];

  /** Fires whenever any session's metadata changes. */
  subscribe(handler: (sessions: SessionMeta[]) => void): Unsubscribe;

  /**
   * Attach to a session's output stream.
   *
   * Replays scrollback first, then streams live. A real driver would take a
   * sequence number here so reattach after a disconnect is idempotent; the
   * mock replays everything because it can.
   */
  attach(id: string, onData: DataHandler): Unsubscribe;

  /** Keystrokes from the terminal, headed for the process's stdin. */
  write(id: string, data: string): void;

  /** SIGWINCH on Unix, ResizePseudoConsole on Windows. */
  resize(id: string, cols: number, rows: number): void;

  /** SIGINT to the process group on Unix, 0x03 / CTRL_C_EVENT on Windows. */
  interrupt(id: string): void;

  /** killpg on Unix, Job Object close on Windows. Kills the whole tree. */
  kill(id: string): void;

  create(options: CreateSessionOptions): Promise<SessionMeta>;
}
