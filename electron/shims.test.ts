import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { shimDirectory } from './shims';

/**
 * The shims are shell scripts, so they are tested by running them against stub
 * agents that print their arguments. Asserting on the text of the scripts
 * would prove nothing about what they do with a real PATH.
 */
const shims = shimDirectory()!;
const fakeBin = mkdtempSync(join(tmpdir(), 'atrium-fakebin-'));
for (const name of ['claude', 'codex']) {
  writeFileSync(join(fakeBin, name), `#!/bin/bash\necho "${name} $@"\n`);
  chmodSync(join(fakeBin, name), 0o755);
}

let state: string;
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'atrium-state-'));
});

afterAll(() => rmSync(fakeBin, { recursive: true, force: true }));

function run(name: string, args: string[] = [], withState = true): string {
  return execFileSync('/bin/bash', [join(shims, name), ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${shims}:${fakeBin}:/usr/bin:/bin`,
      HOME: state,
      ...(withState ? { ATRIUM_SESSION_STATE: state } : {}),
    },
  }).trim();
}

const armResume = (id: string, file = 'resume') => writeFileSync(join(state, file), id);
const currentId = () => readFileSync(join(state, 'current'), 'utf8').trim();

describe('the claude shim', () => {
  it('passes through when Atrium is not managing the session', () => {
    expect(run('claude', ['--model', 'opus'], false)).toBe('claude --model opus');
  });

  it('starts a new conversation with an id Atrium can restore later', () => {
    const out = run('claude');
    expect(out).toMatch(/^claude --session-id [0-9a-f-]{36}$/);
    expect(out).toContain(currentId());
  });

  it('reopens the conversation Atrium armed it with', () => {
    armResume('old-thread');
    expect(run('claude')).toBe('claude --resume old-thread');
    expect(currentId()).toBe('old-thread');
  });

  /**
   * The bug this replaced: the tab was welded to one conversation, so exiting
   * an agent and starting it again reopened the old one instead of beginning a
   * new one. Resuming is a single event, not a property of the tab.
   */
  it('only resumes once, then starts fresh', () => {
    armResume('old-thread');
    expect(run('claude')).toBe('claude --resume old-thread');

    const second = run('claude');
    expect(second).not.toContain('old-thread');
    expect(second).toMatch(/^claude --session-id [0-9a-f-]{36}$/);
    expect(existsSync(join(state, 'resume'))).toBe(false);
  });

  it('records each new conversation, so the next restore reopens that one', () => {
    run('claude');
    const first = currentId();
    run('claude');
    expect(currentId()).not.toBe(first);
  });

  it('keeps the rest of the command line', () => {
    expect(run('claude', ['--dangerously-skip-permissions'])).toMatch(
      /^claude --session-id [0-9a-f-]{36} --dangerously-skip-permissions$/,
    );
  });

  it('does not override a session the user chose', () => {
    armResume('ours');
    for (const flag of [['--resume', 'theirs'], ['--continue'], ['--session-id', 'theirs']]) {
      expect(run('claude', flag)).toBe(`claude ${flag.join(' ')}`);
    }
  });
});

describe('the codex shim', () => {
  /** Codex cannot be told an id, so a fresh run must be left entirely alone. */
  it('leaves a new session untouched', () => {
    expect(run('codex', ['--model', 'gpt-5'])).toBe('codex --model gpt-5');
  });

  it('reopens the thread Atrium armed it with, once', () => {
    armResume('thread-7', 'resume-codex');
    expect(run('codex')).toBe('codex resume thread-7');
    expect(run('codex')).toBe('codex');
  });

  it('stays out of the way of a subcommand', () => {
    armResume('thread-7', 'resume-codex');
    expect(run('codex', ['exec'])).toBe('codex exec');
  });
});
