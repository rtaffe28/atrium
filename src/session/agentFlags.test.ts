import { describe, expect, it } from 'vitest';
import { bindsToSession, withSessionFlag } from './agentFlags';

const ID = '6f1c-uuid';

describe('binding a command to an agent conversation', () => {
  it('claims the id the first time the tab runs', () => {
    expect(withSessionFlag('claude', ID, false)).toBe('claude --session-id 6f1c-uuid');
  });

  /** The whole point: the same tab comes back as the same conversation. */
  it('resumes that exact conversation once it has one', () => {
    expect(withSessionFlag('claude', ID, true)).toBe('claude --resume 6f1c-uuid');
  });

  it('keeps the rest of the command line', () => {
    expect(withSessionFlag('claude --model opus', ID, false)).toBe(
      'claude --session-id 6f1c-uuid --model opus',
    );
  });

  it('leaves a session the user chose alone', () => {
    for (const flag of ['--resume mine', '-r mine', '--continue', '-c', '--session-id mine']) {
      expect(withSessionFlag(`claude ${flag}`, ID, true)).toBe(`claude ${flag}`);
    }
  });

  it('does not touch commands that know nothing about sessions', () => {
    expect(withSessionFlag('npm run dev', ID, false)).toBe('npm run dev');
    expect(withSessionFlag('vim', ID, true)).toBe('vim');
  });

  it('does nothing without an id', () => {
    expect(withSessionFlag('claude', undefined, false)).toBe('claude');
  });

  it('recognises an agent invoked by path', () => {
    expect(bindsToSession('/Users/ryan/.local/bin/claude')).toBe(true);
    expect(bindsToSession('claude')).toBe(true);
    expect(bindsToSession('node')).toBe(false);
  });
});
