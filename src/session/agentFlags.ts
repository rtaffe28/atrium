/**
 * Bind a command to a specific agent conversation.
 *
 * Restoring an agent is only worth anything if it comes back as *the same*
 * conversation. `--continue` resumes whichever one ran most recently in that
 * directory, which is already wrong with two tabs open on one repo.
 *
 * The fix is to stop discovering the session afterwards and decide it up
 * front: every terminal tab carries a uuid, which is handed to Claude Code as
 * `--session-id` the first time and `--resume` on every restore after. The tab
 * and the conversation become the same thing.
 *
 * This is done by rewriting the command Atrium types, rather than by a shim on
 * PATH, because a login shell re-sources its rc files and rebuilds PATH — so a
 * directory we prepend at spawn is routinely shadowed by the user's own.
 */

const SESSION_FLAGS = ['--session-id', '--resume', '-r', '--continue', '-c'];

/** Commands that understand these flags. */
const KNOWN_AGENTS = ['claude'];

export function bindsToSession(command: string): boolean {
  const first = command.trim().split(/\s+/)[0];
  return KNOWN_AGENTS.includes(first?.split('/').pop() ?? '');
}

/**
 * @param hasTranscript whether this id has been used before, which decides
 *   between claiming the id and resuming it.
 */
export function withSessionFlag(
  command: string,
  sessionId: string | undefined,
  hasTranscript: boolean,
): string {
  const trimmed = command.trim();
  if (!sessionId || !bindsToSession(trimmed)) return trimmed;

  // An explicit choice by the user always wins; they may be deliberately
  // opening a different conversation in this tab.
  const words = trimmed.split(/\s+/);
  if (words.some((word) => SESSION_FLAGS.includes(word))) return trimmed;

  const flag = hasTranscript ? '--resume' : '--session-id';
  return `${words[0]} ${flag} ${sessionId}${words.length > 1 ? ' ' + words.slice(1).join(' ') : ''}`;
}
