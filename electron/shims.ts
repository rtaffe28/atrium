import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ATRIUM from './shell/atrium.sh';
import BASHRC from './shell/bashrc.sh';
import CLAUDE_SHIM from './shell/claude.sh';
import HOOK from './shell/hook.sh';
import CODEX_SHIM from './shell/codex.sh';
import ZSHENV from './shell/zshenv.zsh';

/**
 * Agent shims and shell integration.
 *
 * Two problems are solved here, and the scripts that solve them live in
 * ./shell as real shell files rather than string literals — they were template
 * literals until the escaping ate a backslash and shipped an integration that
 * emitted nothing. Three levels of quoting to get one character through is not
 * something to be careful about; it is something to remove.
 *
 * **Binding a tab to a conversation.** Resuming is a one-shot event, not a
 * property of the tab: after you exit an agent and start it again you want a
 * new conversation, not the old one back. Only Atrium restoring the tab means
 * "reopen what was there", so it leaves a marker for exactly that case and the
 * shim consumes it.
 *
 * **Telling Atrium what is happening.** The integration speaks VS Code's OSC
 * 633 / OSC 133 protocol, so the shell reports the command line and its exit
 * code instead of Atrium inferring them from the foreground process — which
 * lies when a process renames itself — and from reassembled keystrokes.
 *
 * The shell can only report on the shell. What the agent inside it is doing,
 * and which conversation it is on, only the agent knows — so Claude Code is
 * handed a settings file registering its lifecycle hooks against `hook`, and
 * says both itself.
 */

/**
 * Where these files live: a stable directory under the app's own data.
 *
 * A fresh temp directory per launch left dozens of orphans that nothing owned,
 * and made them easy to delete out from under a running app — which silently
 * unbinds every open tab.
 */
let baseDir: string | null = null;

export function useBaseDirectory(dir: string): void {
  baseDir = dir;
}

/** Rewritten on each launch, so an updated script actually ships. */
function makeDirectory(name: string): string {
  if (!baseDir) return mkdtempSync(join(tmpdir(), `atrium-${name}-`));
  const dir = join(baseDir, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Named by the shim as well, which passes it to `claude --settings`. */
export const CLAUDE_SETTINGS = 'claude-settings.json';

/**
 * What Claude Code is told on every run in an Atrium tab.
 *
 * The SessionStart hook says which conversation a tab is on, however that
 * conversation began — new, --resume, --continue, the picker, or /resume
 * inside a running session — which is what restore needs and nothing outside
 * the agent can observe.
 *
 * The notification channel is how a tab hears that Claude wants you. Claude
 * only picks one for itself in terminals it recognises by name, and Atrium is
 * not one of them, so it is named here: `ghostty` is OSC 777, a title and a
 * body, which the tab reads like any other notification — see signals.ts.
 *
 * `--settings` is an additional layer rather than a replacement, so the user's
 * own hooks still run; Claude concatenates the arrays.
 */
function claudeSettings(hook: string): string {
  return JSON.stringify({
    preferredNotifChannel: 'ghostty',
    hooks: {
      SessionStart: [
        { hooks: [{ type: 'command', command: JSON.stringify(hook), timeout: 5 }] },
      ],
    },
  });
}

let cached: string | null = null;

/** Create the shim directory once per app run. */
export function shimDirectory(): string | null {
  if (cached) return cached;
  if (process.platform === 'win32') return null;
  try {
    const dir = makeDirectory('shims');
    for (const [name, body] of [
      ['claude', CLAUDE_SHIM],
      ['codex', CODEX_SHIM],
      ['hook', HOOK],
      // The command a program in a tab talks to Atrium with; see requests.ts.
      ['atrium', ATRIUM],
    ] as const) {
      const shim = join(dir, name);
      writeFileSync(shim, body, 'utf8');
      chmodSync(shim, 0o755);
    }
    writeFileSync(join(dir, CLAUDE_SETTINGS), claudeSettings(join(dir, 'hook')), 'utf8');
    cached = dir;
    return dir;
  } catch (error) {
    // Agents still run without shims; they just cannot be bound to a session,
    // so a command typed by hand will not be resumable. Worth saying out loud
    // rather than degrading in silence — that failure is invisible until a
    // restart does not restore what you were doing.
    console.error('[atrium] could not create agent shims:', error);
    return null;
  }
}

export interface ShellStartup {
  env: Record<string, string>;
  args: string[];
}

let startupDir: string | null = null;

/**
 * Shell integration is installed through zsh's own ZDOTDIR, and the only file
 * we provide is `.zshenv`, which hands ZDOTDIR straight back before doing
 * anything else. That ordering matters more than it looks: `/etc/zshrc`
 * derives HISTFILE from ZDOTDIR, so a wrapper that holds onto it writes the
 * user's shell history into a temp directory.
 */
function zshStartup(): string | null {
  if (startupDir) return startupDir;
  try {
    const dir = makeDirectory('zdotdir');
    writeFileSync(join(dir, '.zshenv'), ZSHENV, 'utf8');
    startupDir = dir;
    return dir;
  } catch {
    return null;
  }
}

let bashrcFile: string | null = null;

/**
 * bash has no ZDOTDIR, so integration goes in through `--init-file`, which
 * replaces the interactive startup files rather than adding to them. The file
 * sources them back itself — see the script.
 */
function bashStartup(): string | null {
  if (bashrcFile) return bashrcFile;
  try {
    const file = join(makeDirectory('bash'), 'bashrc');
    writeFileSync(file, BASHRC, 'utf8');
    bashrcFile = file;
    return file;
  } catch {
    return null;
  }
}

/** Env and args that give a session our shell integration, if we can. */
export function shellStartup(shellPath: string): ShellStartup {
  const shims = shimDirectory();
  if (!shims) return { env: {}, args: [] };

  const shell = shellPath.split('/').pop() ?? '';

  if (shell === 'zsh') {
    const dir = zshStartup();
    if (dir) {
      return {
        env: {
          ZDOTDIR: dir,
          ATRIUM_USER_ZDOTDIR: process.env.ZDOTDIR ?? '',
          ATRIUM_SHIM_DIR: shims,
        },
        args: [],
      };
    }
  }

  if (shell === 'bash') {
    const file = bashStartup();
    if (file) return { env: { ATRIUM_SHIM_DIR: shims }, args: ['--init-file', file] };
  }

  // Any other shell keeps the plain PATH prefix, which works only where rc
  // files leave PATH alone. They frequently do not — a shell we cannot hook is
  // a shell whose tabs will not bind to a conversation.
  return { env: {}, args: [] };
}
