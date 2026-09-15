import { describe, expect, it } from 'vitest';
import { plausibleCommand } from './command';

describe('plausibleCommand', () => {
  it('rejects a version string, which is what a renamed agent reports', () => {
    // The actual failure: restore typed "2.1.273" into a shell.
    expect(plausibleCommand('2.1.273')).toBeUndefined();
  });

  it('keeps ordinary commands and full command lines', () => {
    expect(plausibleCommand('claude')).toBe('claude');
    expect(plausibleCommand('claude --continue')).toBe('claude --continue');
    expect(plausibleCommand('npm run dev')).toBe('npm run dev');
    expect(plausibleCommand('node_exporter')).toBe('node_exporter');
    expect(plausibleCommand('python3.11')).toBe('python3.11');
  });

  it('rejects anything that could not start a command', () => {
    expect(plausibleCommand('')).toBeUndefined();
    expect(plausibleCommand('   ')).toBeUndefined();
    expect(plausibleCommand('-flag')).toBeUndefined();
    expect(plausibleCommand('3rd-party')).toBeUndefined();
    expect(plausibleCommand(undefined)).toBeUndefined();
  });
});
