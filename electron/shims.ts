import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    const dir = mkdtempSync(join(tmpdir(), 'atrium-shims-'));
    for (const [name, body] of [['claude', CLAUDE_SHIM], ['codex', CODEX_SHIM]] as const) {
      const shim = join(dir, name);
      writeFileSync(shim, body, 'utf8');
      chmodSync(shim, 0o755);
    }
    cached = dir;
    return dir;
  } catch {
    // Without shims agents still run; they just cannot be resumed exactly.
    return null;
  }
}


/**
 * Shell startup files that put the shim directory back at the front of PATH.
 *
 * Prepending it when we spawn the shell is not enough: a login shell sources
 * the user's rc files afterwards, and those rebuild PATH — measured on a normal
 * zsh setup, `command -v claude` inside a session resolved to
 * ~/.local/bin/claude rather than the shim. The only place to win is *after*
 * the user's own configuration has run, which is what these files are for.
 *
 * This is the same trick editors use for shell integration. The user's files
 * are sourced first and unchanged, and ZDOTDIR is handed back afterwards so
 * anything they run later sees their own setup.
 */
export interface ShellStartup {
  env: Record<string, string>;
  args: string[];
}

let startupDir: string | null = null;

function zshStartup(shims: string): string | null {
  if (startupDir) return startupDir;
  try {
    const dir = mkdtempSync(join(tmpdir(), 'atrium-zdotdir-'));
    const sourceUser = (file: string) =>
      `[ -f "\${ATRIUM_USER_ZDOTDIR:-$HOME}/${file}" ] && ` +
      `. "\${ATRIUM_USER_ZDOTDIR:-$HOME}/${file}"
`;

    writeFileSync(join(dir, '.zshenv'), sourceUser('.zshenv'), 'utf8');
    writeFileSync(join(dir, '.zprofile'), sourceUser('.zprofile'), 'utf8');
    writeFileSync(join(dir, '.zlogin'), sourceUser('.zlogin'), 'utf8');
    writeFileSync(
      join(dir, '.zshrc'),
      sourceUser('.zshrc') +
        `# Atrium: after your configuration, so agent shims win.
` +
        `export PATH="${shims}:$PATH"
` +
        `export ZDOTDIR="\${ATRIUM_USER_ZDOTDIR:-$HOME}"
`,
      'utf8',
    );
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

  const name = shellPath.split('/').pop() ?? '';
  if (name === 'zsh') {
    const dir = zshStartup(shims);
    if (dir) {
      return {
        env: {
          ZDOTDIR: dir,
          ATRIUM_USER_ZDOTDIR: process.env.ZDOTDIR ?? process.env.HOME ?? '',
        },
        args: [],
      };
    }
  }
  // Other shells keep the plain PATH prefix, which works wherever rc files
  // leave PATH alone.
  return { env: {}, args: [] };
}