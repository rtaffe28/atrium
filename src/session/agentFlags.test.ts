import { describe, expect, it } from 'vitest';
import { agentOf, withSessionFlag } from './agentFlags';

const CLAUDE = 'c1aude-uuid';
const CODEX = 'c0dex-uuid';

describe('Claude Code, which can be told its session up front', () => {
  it('claims the id the first time the tab runs', () => {
    expect(withSessionFlag('claude', { claude: CLAUDE, claudeExists: false })).toBe(
      'claude --session-id c1aude-uuid',
    );
  });

  it('resumes that exact conversation once it exists', () => {
    expect(withSessionFlag('claude', { claude: CLAUDE, claudeExists: true })).toBe(
      'claude --resume c1aude-uuid',
    );
  });

  it('keeps the rest of the command line', () => {
    expect(
      withSessionFlag('claude --dangerously-skip-permissions', {
        claude: CLAUDE,
        claudeExists: false,
      }),
    ).toBe('claude --session-id c1aude-uuid --dangerously-skip-permissions');
  });

  it('leaves a session the user chose alone', () => {
    for (const flag of ['--resume mine', '-r mine', '--continue', '-c', '--session-id mine']) {
      expect(withSessionFlag(`claude ${flag}`, { claude: CLAUDE, claudeExists: true })).toBe(
        `claude ${flag}`,
      );
    }
  });
});

describe('Codex, whose id can only be observed afterwards', () => {
  /** Nothing to bind to yet — the id does not exist until codex writes it. */
  it('runs a fresh session unchanged', () => {
    expect(withSessionFlag('codex', {})).toBe('codex');
    expect(withSessionFlag('codex --model gpt-5', {})).toBe('codex --model gpt-5');
  });

  it('resumes by id once one has been observed', () => {
    expect(withSessionFlag('codex', { codex: CODEX })).toBe('codex resume c0dex-uuid');
  });

  it('keeps flags, which codex resume accepts too', () => {
    expect(
      withSessionFlag('codex --dangerously-bypass-approvals-and-sandbox', { codex: CODEX }),
    ).toBe('codex resume c0dex-uuid --dangerously-bypass-approvals-and-sandbox');
  });

  it('does not interfere with a subcommand the user asked for', () => {
    for (const sub of ['resume --last', 'exec "do a thing"', 'login', 'apply']) {
      expect(withSessionFlag(`codex ${sub}`, { codex: CODEX })).toBe(`codex ${sub}`);
    }
  });
});

describe('everything else', () => {
  it('is left alone', () => {
    expect(withSessionFlag('npm run dev', { claude: CLAUDE, codex: CODEX })).toBe('npm run dev');
    expect(agentOf('vim')).toBeNull();
  });

  it('recognises an agent invoked by path', () => {
    expect(agentOf('/Users/ryan/.local/bin/claude')).toBe('claude');
    expect(agentOf('/opt/homebrew/bin/codex')).toBe('codex');
  });
});
