import { describe, expect, it } from 'vitest';
import { stripAgentSession } from './env';

/**
 * Launching Atrium from inside a coding-agent session used to hand every
 * terminal it opened that session's identity. Claude Code read
 * CLAUDE_CODE_CHILD_SESSION, decided it was a nested invocation, and turned
 * off transcript saving and trust persistence — so it asked to trust the same
 * folder on every launch and never saved a conversation.
 */
describe('stripping the launcher agent session', () => {
  it('removes the markers that make an agent think it is nested', () => {
    const clean = stripAgentSession({
      CLAUDECODE: '1',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_SESSION_ID: 'abc',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_EXECPATH: '/x',
      CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/s',
      CLAUDE_CODE_MESSAGING_TOKEN: 'secret',
      CLAUDE_PID: '123',
      CLAUDE_EFFORT: 'xhigh',
      PATH: '/usr/bin',
    });

    expect(Object.keys(clean)).toEqual(['PATH']);
  });

  /** Credentials and preferences are the user's, not our launcher's. */
  it('keeps everything the shell legitimately owns', () => {
    const clean = stripAgentSession({
      ANTHROPIC_API_KEY: 'sk-x',
      ANTHROPIC_BASE_URL: 'https://example',
      HOME: '/Users/ryan',
      SHELL: '/bin/zsh',
      PATH: '/usr/bin',
      EDITOR: 'vim',
    });

    expect(Object.keys(clean).sort()).toEqual([
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_BASE_URL',
      'EDITOR',
      'HOME',
      'PATH',
      'SHELL',
    ]);
  });

  it('does not invent variables or drop empty values', () => {
    expect(stripAgentSession({})).toEqual({});
    expect(stripAgentSession({ EMPTY: '' })).toEqual({ EMPTY: '' });
  });
});
