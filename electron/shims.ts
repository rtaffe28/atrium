import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Where the shim and shell-integration files live.
 *
 * A stable directory under the app's own data, not a fresh temp directory per
 * launch. Scattering them through /var/folders left dozens of orphans that
 * nothing owned and nothing cleaned up — and made them easy to delete out from
 * under a running app, which silently unbinds every open tab.
 *
 * Rewritten on each launch so an updated shim actually ships.
 */
let baseDir: string | null = null;

export function useBaseDirectory(dir: string): void {
  baseDir = dir;
}

function makeDirectory(name: string): string {
  if (!baseDir) return mkdtempSync(join(tmpdir(), `atrium-${name}-`));
  const dir = join(baseDir, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * A shim directory placed at the front of every session's PATH.
 *
 * The problem it solves: restoring an agent is only useful if it comes back as
 * *the same conversation*. `--continue` resumes whichever conversation ran most
 * recently in that directory, which is wrong the moment two tabs share one —
 * and it is no help at all for a session you typed yourself.
 *
 * The fix is to stop trying to discover the session after the fact and instead
 * decide it up front: Atrium assigns each agent tab a uuid, and the shim passes
 * it to Claude Code as `--session-id`. From then on the tab and the
 * conversation are the same thing, and restoring is exact rather than a guess.
 *
 * The shim exists because the command is often typed by a human rather than
 * launched by us, and a wrapper on PATH is the only place to intervene in that.
 */

const CODEX_SHIM = `#!/bin/bash
# Atrium shim. Codex cannot be told its session id up front — there is no
# --session-id — so Atrium discovers the id after the first run and passes it
# back here, which turns a bare \`codex\` into a resume of this tab's thread.

self_dir="$(cd "$(dirname "$0")" && pwd)"
clean=""
old_ifs="$IFS"
IFS=:
for entry in $PATH; do
  [ "$entry" = "$self_dir" ] && continue
  clean="\${clean:+$clean:}$entry"
done
IFS="$old_ifs"
export PATH="$clean"

real="$(command -v codex 2>/dev/null)"
if [ -z "$real" ]; then
  echo "atrium: codex is not on PATH" >&2
  exit 127
fi

# A subcommand means the user is driving — resume, exec, login, anything.
case "\${1:-}" in
  ""|-*) ;;
  *) exec "$real" "$@" ;;
esac

if [ -z "\${ATRIUM_CODEX_SESSION:-}" ]; then
  exec "$real" "$@"
fi
exec "$real" resume "$ATRIUM_CODEX_SESSION" "$@"
`;

const CLAUDE_SHIM = `#!/bin/bash
# Atrium shim. Binds this terminal's Claude Code conversation to a stable id so
# the session can be restored exactly, rather than by "most recent here".

self_dir="$(cd "$(dirname "$0")" && pwd)"

# Drop ourselves from PATH before looking for the real binary, or this execs
# itself forever.
clean=""
old_ifs="$IFS"
IFS=:
for entry in $PATH; do
  [ "$entry" = "$self_dir" ] && continue
  clean="\${clean:+$clean:}$entry"
done
IFS="$old_ifs"
export PATH="$clean"

real="$(command -v claude 2>/dev/null)"
if [ -z "$real" ]; then
  echo "atrium: claude is not on PATH" >&2
  exit 127
fi

# An explicit choice by the user always wins.
for arg in "$@"; do
  case "$arg" in
    --session-id|--resume|-r|--continue|-c) exec "$real" "$@" ;;
  esac
done

if [ -z "\${ATRIUM_AGENT_SESSION:-}" ]; then
  exec "$real" "$@"
fi

# If this id already has a transcript, resume it; otherwise claim it. Checking
# rather than being told means a restored tab and a fresh one run the same
# command and still do the right thing.
if ls "$HOME"/.claude/projects/*/"$ATRIUM_AGENT_SESSION".jsonl >/dev/null 2>&1; then
  exec "$real" --resume "$ATRIUM_AGENT_SESSION" "$@"
fi
exec "$real" --session-id "$ATRIUM_AGENT_SESSION" "$@"
`;

let cached: string | null = null;

/** Create the shim directory once per app run. */
export function shimDirectory(): string | null {
  if (cached) return cached;
  if (process.platform === 'win32') return null;
  try {
    const dir = makeDirectory('shims');
    for (const [name, body] of [['claude', CLAUDE_SHIM], ['codex', CODEX_SHIM]] as const) {
      const shim = join(dir, name);
      writeFileSync(shim, body, 'utf8');
      chmodSync(shim, 0o755);
    }
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


/**
 * Shell integration: put the shim directory back in front of PATH.
 *
 * Prepending it when we spawn the shell is not enough — a login shell sources
 * the user's rc files afterwards and those rebuild PATH. Measured on a normal
 * zsh setup, `command -v claude` inside a session resolved to
 * ~/.local/bin/claude rather than the shim.
 *
 * So zsh is pointed at our own ZDOTDIR, and the *only* file we provide is
 * `.zshenv`, which hands ZDOTDIR straight back before doing anything else.
 * That ordering matters more than it looks: `/etc/zshrc` derives HISTFILE from
 * ZDOTDIR, so a wrapper that holds onto it through startup quietly writes the
 * user's shell history into a temp directory. Restoring first means zsh then
 * finds .zprofile and .zshrc in their real place and loads them normally.
 *
 * The PATH fix therefore cannot live in an rc file of ours — there is none
 * left. It runs from a one-shot `precmd` hook instead, which fires after all
 * of the user's configuration and before their first prompt.
 */
export interface ShellStartup {
  env: Record<string, string>;
  args: string[];
}

const ZSHENV = `# Atrium shell integration.
#
# Hand ZDOTDIR back immediately: /etc/zshrc derives HISTFILE from it, and zsh
# needs to find the user's own .zprofile and .zshrc in their real location.
if [[ -n "\${ATRIUM_USER_ZDOTDIR+X}" ]]; then
  builtin export ZDOTDIR="$ATRIUM_USER_ZDOTDIR"
  builtin unset ATRIUM_USER_ZDOTDIR
else
  builtin unset ZDOTDIR
fi

_atrium_file="\${ZDOTDIR-$HOME}/.zshenv"
[[ -r "$_atrium_file" ]] && builtin source -- "$_atrium_file"
builtin unset _atrium_file

# Put the agent shims back in front once the user's configuration has run.
# A precmd hook is the first moment that is true.
if [[ -o interactive && -n "\${ATRIUM_SHIM_DIR:-}" ]]; then
  _atrium_restore_path() {
    builtin export PATH="$ATRIUM_SHIM_DIR:$PATH"
    add-zsh-hook -d precmd _atrium_restore_path
    builtin unset -f _atrium_restore_path
  }
  builtin autoload -Uz add-zsh-hook
  add-zsh-hook precmd _atrium_restore_path
fi
`;

let startupDir: string | null = null;

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

/** Env and args that give a session our shell integration, if we can. */
export function shellStartup(shellPath: string): ShellStartup {
  const shims = shimDirectory();
  if (!shims) return { env: {}, args: [] };

  if ((shellPath.split('/').pop() ?? '') === 'zsh') {
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
  // Other shells keep the plain PATH prefix, which works wherever rc files
  // leave PATH alone.
  return { env: {}, args: [] };
}
