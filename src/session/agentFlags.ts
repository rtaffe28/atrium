/**
 * Bind a command to a specific agent conversation.
 *
 * Restoring an agent is only worth anything if it comes back as *the same*
 * conversation. Resuming "the most recent one in this directory" is already
 * wrong with two tabs open on one repo.
 *
 * The two agents need opposite approaches, because their CLIs differ:
 *
 * - **Claude Code** takes `--session-id`, so Atrium decides the id up front and
 *   the tab claims it. Restoring is then `--resume <id>` — exact, and settled
 *   before the agent ever runs.
 * - **Codex** has no equivalent; a session id can only be *observed* after the
 *   fact, from the rollout file it writes. So a fresh codex tab runs plainly,
 *   Atrium learns the id, and only restores are rewritten to
 *   `codex resume <id>`.
 */

export type AgentName = 'claude' | 'codex';

/** Flags and subcommands that mean the user has chosen a session themselves. */
const USER_CHOSE: Record<AgentName, string[]> = {
  claude: ['--session-id', '--resume', '-r', '--continue', '-c'],
  codex: ['resume', 'fork', 'exec', 'e', 'review', 'login', 'logout', 'mcp', 'apply', 'a'],
};

export interface SessionIds {
  /** Assigned by Atrium before the tab ever runs. */
  claude?: string;
  /** Observed after codex has written its rollout file. */
  codex?: string;
  /** Whether the Claude conversation already exists, which picks the flag. */
  claudeExists?: boolean;
}

export function agentOf(command: string): AgentName | null {
  const first = command.trim().split(/\s+/)[0]?.split('/').pop();
  return first === 'claude' || first === 'codex' ? first : null;
}

export function withSessionFlag(command: string, ids: SessionIds): string {
  const trimmed = command.trim();
  const agent = agentOf(trimmed);
  if (!agent) return trimmed;

  const words = trimmed.split(/\s+/);
  const rest = words.slice(1);

  // An explicit choice always wins; they may be deliberately opening something
  // else in that tab.
  if (rest.some((word) => USER_CHOSE[agent].includes(word))) return trimmed;

  if (agent === 'claude') {
    if (!ids.claude) return trimmed;
    const flag = ids.claudeExists ? '--resume' : '--session-id';
    return [words[0], flag, ids.claude, ...rest].join(' ');
  }

  // Codex cannot be told an id, only asked to resume one it already made.
  if (!ids.codex) return trimmed;
  return [words[0], 'resume', ids.codex, ...rest].join(' ');
}
