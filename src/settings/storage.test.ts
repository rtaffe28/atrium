import { describe, expect, it } from 'vitest';
import { applyRestoreOverride } from './storage';

const RULES = 'claude = claude --continue';

describe('restore command overrides', () => {
  it('rewrites a bare agent into its resuming form', () => {
    // The whole point: `claude` alone reopens a blank conversation.
    expect(applyRestoreOverride('claude', RULES)).toBe('claude --continue');
  });

  it('matches on the command, not the whole line', () => {
    expect(applyRestoreOverride('claude --model opus', RULES)).toBe('claude --continue');
  });

  it('leaves unmatched commands alone', () => {
    expect(applyRestoreOverride('npm run dev', RULES)).toBe('npm run dev');
    expect(applyRestoreOverride('vim', RULES)).toBe('vim');
  });

  it('treats an empty replacement as "do not run anything"', () => {
    expect(applyRestoreOverride('vim', 'vim =')).toBeUndefined();
  });

  it('handles several rules, blank lines and stray whitespace', () => {
    const rules = '\n  claude = claude --continue  \n\nnode = node --watch\n';
    expect(applyRestoreOverride('node server.js', rules)).toBe('node --watch');
    expect(applyRestoreOverride('claude', rules)).toBe('claude --continue');
  });

  it('keeps replacements that themselves contain an equals sign', () => {
    expect(applyRestoreOverride('run', 'run = run --flag=1')).toBe('run --flag=1');
  });

  it('passes through when there is nothing to restore', () => {
    expect(applyRestoreOverride(undefined, RULES)).toBeUndefined();
  });
});
