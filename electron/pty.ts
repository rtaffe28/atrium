import { spawn, type IPty } from 'node-pty';
import type { WebContents } from 'electron';
import { shellStartup, shimDirectory } from './shims';

export interface SpawnOptions {
  id: string;
  shell?: string;
  args?: string[];
  cwd: string;
  cols: number;
  rows: number;
  /** Extra variables for this session only — the agent session id lives here. */
  env?: Record<string, string>;
}

interface Entry {
  pty: IPty;
  /** Everything written so far, so a reattach can replay it. */
  buffer: string;
}

const SCROLLBACK_LIMIT = 2_000_000; // bytes; ~ a few thousand lines

/**
 * Every live pseudo-terminal, owned by the main process.
 *
 * The renderer never touches node-pty. It sends intent over IPC and receives
 * bytes back on a one-way channel, because pushing high-frequency output
 * through request/response would serialise the whole terminal.
 */
export class PtyManager {
  private entries = new Map<string, Entry>();

  constructor(
    private env: NodeJS.ProcessEnv,
    private send: (channel: string, ...args: unknown[]) => void,
  ) {}

  spawn(options: SpawnOptions): { pid: number } {
    this.kill(options.id);

    const shell =
      options.shell ??
      (process.platform === 'win32'
        ? process.env.COMSPEC ?? 'powershell.exe'
        : this.env.SHELL ?? '/bin/zsh');

    // The shim directory goes first so agent commands resolve to our wrappers.
    // Shell integration then puts it back after the user's rc files have run,
    // which is the only placement that actually survives a login shell.
    const shims = shimDirectory();
    const path = shims ? `${shims}:${this.env.PATH ?? ''}` : this.env.PATH;
    const startup = shellStartup(shell);

    const term = spawn(shell, [...(options.args ?? []), ...startup.args], {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: {
        ...this.env,
        ...startup.env,
        ...(options.env ?? {}),
        ...(path ? { PATH: path } : {}),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });

    const entry: Entry = { pty: term, buffer: '' };
    this.entries.set(options.id, entry);

    term.onData((data) => {
      entry.buffer += data;
      if (entry.buffer.length > SCROLLBACK_LIMIT) {
        entry.buffer = entry.buffer.slice(-SCROLLBACK_LIMIT);
      }
      this.send('pty:data', options.id, data);
    });

    term.onExit(({ exitCode }) => {
      this.entries.delete(options.id);
      this.send('pty:exit', options.id, exitCode);
    });

    return { pid: term.pid };
  }

  /**
   * The foreground process of each live pty, by tab id.
   *
   * This is how a terminal knows what is actually running in it — the tty's
   * foreground process group — rather than guessing from what was typed.
   */
  foreground(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [id, entry] of this.entries) {
      try {
        out[id] = entry.pty.process;
      } catch {
        // The process died between iterating and asking.
      }
    }
    return out;
  }

  /** Scrollback for a tab that is mounting or remounting. */
  replay(id: string): string {
    return this.entries.get(id)?.buffer ?? '';
  }

  write(id: string, data: string) {
    this.entries.get(id)?.pty.write(data);
  }

  resize(id: string, cols: number, rows: number) {
    try {
      this.entries.get(id)?.pty.resize(cols, rows);
    } catch {
      // Throws if the process died between the check and the call.
    }
  }

  /** SIGINT to the foreground process group, as Ctrl-C would. */
  interrupt(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    // Writing the byte is more faithful than signalling the pty's own pid: the
    // line discipline turns it into SIGINT for whatever is in the foreground,
    // and on Windows the console host generates CTRL_C_EVENT the same way.
    entry.pty.write('\x03');
  }

  kill(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    try {
      entry.pty.kill();
    } catch {
      // Already gone.
    }
    this.entries.delete(id);
  }

  killAll() {
    for (const id of [...this.entries.keys()]) this.kill(id);
  }

  bind(contents: WebContents) {
    this.send = (channel, ...args) => {
      if (!contents.isDestroyed()) contents.send(channel, ...args);
    };
  }
}
