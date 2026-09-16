import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { shimDirectory } from './shims';

/**
 * The shim is a shell script, so it is tested by running it against a stub
 * `claude` that prints its arguments. Asserting on the text of the script
 * would prove nothing about what it actually does with a real PATH.
 */
const shims = shimDirectory()!;
const fakeBin = mkdtempSync(join(tmpdir(), 'atrium-fakebin-'));
writeFileSync(join(fakeBin, 'claude'), '#!/bin/bash\necho "claude $@"\n');
chmodSync(join(fakeBin, 'claude'), 0o755);

const home = mkdtempSync(join(tmpdir(), 'atrium-fakehome-'));

afterAll(() => {
  rmSync(fakeBin, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

function runShim(args: string[], env: Record<string, string> = {}): string {
  return execFileSync('/bin/bash', [join(shims, 'claude'), ...args], {
    encoding: 'utf8',
    env: { PATH: `${shims}:${fakeBin}:/usr/bin:/bin`, HOME: home, ...env },
  }).trim();
}

function giveSessionATranscript(id: string) {
  const dir = join(home, '.claude', 'projects', '-some-project');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.jsonl`), '{}');
}

describe('the claude shim', () => {
  it('passes straight through when no session is assigned', () => {
    expect(runShim(['--model', 'opus'])).toBe('claude --model opus');
  });

  it('claims the assigned id the first time the session runs', () => {
    expect(runShim(['--model', 'opus'], { ATRIUM_AGENT_SESSION: 'fresh-1' })).toBe(
      'claude --session-id fresh-1 --model opus',
    );
  });

  /** The whole point: the same tab comes back as the same conversation. */
  it('resumes that exact conversation once it has a transcript', () => {
    giveSessionATranscript('known-2');
    expect(runShim([], { ATRIUM_AGENT_SESSION: 'known-2' })).toBe('claude --resume known-2');
  });

  it('does not override a session the user chose', () => {
    expect(runShim(['--resume', 'theirs'], { ATRIUM_AGENT_SESSION: 'ours' })).toBe(
      'claude --resume theirs',
    );
    expect(runShim(['--continue'], { ATRIUM_AGENT_SESSION: 'ours' })).toBe('claude --continue');
    expect(runShim(['--session-id', 'theirs'], { ATRIUM_AGENT_SESSION: 'ours' })).toBe(
      'claude --session-id theirs',
    );
  });

  /** A shim that finds itself on PATH execs itself forever. */
  it('removes itself from PATH before looking for the real binary', () => {
    expect(runShim([], { ATRIUM_AGENT_SESSION: 'x' })).toContain('claude --session-id x');
  });

  it('fails clearly when claude is not installed', () => {
    let message = '';
    try {
      execFileSync('/bin/bash', [join(shims, 'claude')], {
        encoding: 'utf8',
        env: { PATH: `${shims}:/usr/bin:/bin`, HOME: home },
        stdio: 'pipe',
      });
    } catch (error) {
      message = String((error as { stderr?: string }).stderr ?? '');
    }
    expect(message).toContain('claude is not on PATH');
  });
});
