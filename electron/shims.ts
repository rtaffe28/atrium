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
    const shim = join(dir, 'claude');
    writeFileSync(shim, CLAUDE_SHIM, 'utf8');
    chmodSync(shim, 0o755);
    cached = dir;
    return dir;
  } catch {
    // Without shims agents still run; they just cannot be resumed exactly.
    return null;
  }
}
