import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

/** How long an agent gets to exit on its own before the shell is torn down. */
const GRACEFUL_EXIT_MS = 5000;

const run = promisify(execFile);

/** Every descendant pid of the given roots, deepest last. */
async function descendants(roots: number[]): Promise<number[]> {
  const { stdout } = await run('ps', ['-axo', 'pid=,ppid=']).catch(() => ({ stdout: '' }));
  const children = new Map<number, number[]>();
  for (const line of stdout.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid || !ppid) continue;
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const found: number[] = [];
  const walk = (pid: number) => {
    for (const child of children.get(pid) ?? []) {
      found.push(child);
      walk(child);
    }
  };
  for (const root of roots) walk(root);
  return found;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

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

    const env: NodeJS.ProcessEnv = {
      ...this.env,
      ...startup.env,
      ...(options.env ?? {}),
      ...(path ? { PATH: path } : {}),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      // Say which terminal this is. A dev run launched from Ghostty or iTerm
      // otherwise hands its tabs that terminal's name, and agents switch on
      // it — Claude picks its notification channel and its keyboard handling
      // from TERM_PROGRAM, for a terminal that is not the one drawing them.
      TERM_PROGRAM: 'Atrium',
    };
    delete env.TERM_PROGRAM_VERSION;

    const term = spawn(shell, [...(options.args ?? []), ...startup.args], {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: env as Record<string, string>,
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

  /**
   * Let the agents exit before tearing the shells down.
   *
   * Killing the pty sends SIGHUP to the shell, which hangs up its jobs and
   * prints "zsh: warning: 1 jobs SIGHUPed" — noise that then lives in the
   * scrollback forever, since a restored tab replays it. Worse, an agent
   * killed that way never gets to finish writing its session, and a session
   * that was not written cannot be resumed, which is the thing restore exists
   * to do.
   *
   * So the agents are asked to stop first and given a moment, and only what is
   * still alive afterwards is taken down hard.
   */
  async shutdown(): Promise<void> {
    const shells = [...this.entries.values()].map((entry) => entry.pty.pid);
    if (shells.length === 0) return;

    const agents = await descendants(shells);
    for (const pid of agents) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Already gone.
      }
    }

    const deadline = Date.now() + GRACEFUL_EXIT_MS;
    while (Date.now() < deadline && agents.some(alive)) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Anything still running gets killed outright, and that is deliberate:
    // the shell must have no jobs left when it is hung up, or it prints the
    // warning regardless. An agent caught mid-startup has not installed its
    // signal handler yet and will sit through SIGTERM indefinitely.
    const stubborn = agents.filter(alive);
    for (const pid of stubborn) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Won the race.
      }
    }
    if (stubborn.length > 0) await new Promise((resolve) => setTimeout(resolve, 300));

    this.killAll();
  }

  /** How many sessions are running something other than their shell. */
  busyCount(shellName: string): number {
    return Object.values(this.foreground()).filter((name) => name && name !== shellName).length;
  }

  bind(contents: WebContents) {
    this.send = (channel, ...args) => {
      if (!contents.isDestroyed()) contents.send(channel, ...args);
    };
  }
}
