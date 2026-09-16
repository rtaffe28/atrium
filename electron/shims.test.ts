import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { shellStartup, shimDirectory } from './shims';

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

/**
 * The bug this covers: on Linux the default shell is bash, which got no
 * integration at all. Atrium prefixes PATH before spawning, and Ubuntu's stock
 * `.bashrc` then prepends `~/.local/bin` — where the agent is installed — so
 * `claude` resolved to the real binary and the shim never ran once. Nothing
 * said so. The tab simply came back on a new conversation after a restart.
 */
describe('bash shell integration', () => {
  const startup = shellStartup('/bin/bash');
  const initFile = startup.args[1];

  /**
   * The shell reports on the same stream it prints on, so its own OSC
   * sequences come off before anything is asserted. Their presence is the
   * integration working, not noise to be silenced.
   */
  // oxlint-disable-next-line no-control-regex -- the sequences are the point
  const spoken = (out: string) => out.replace(/\u001b\][^\u0007]*\u0007/g, '').trim();

  it('is installed with --init-file, since bash has no ZDOTDIR', () => {
    expect(startup.args[0]).toBe('--init-file');
    expect(initFile).toBeTruthy();
    expect(startup.env.ATRIUM_SHIM_DIR).toBe(shims);
  });

  /** Runs a real bash against a hostile rc file and asks it what it resolved. */
  function bashResolves(rc: string): string {
    const home = mkdtempSync(join(tmpdir(), 'atrium-home-'));
    writeFileSync(join(home, '.bashrc'), rc);
    return execFileSync(
      '/bin/bash',
      ['--init-file', initFile, '-i', '-c', 'command -v claude'],
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
        env: {
          HOME: home,
          TERM: 'dumb',
          PATH: `${shims}:${fakeBin}:/usr/bin:/bin`,
          ATRIUM_SHIM_DIR: shims,
        },
      },
    );
  }

  it('keeps the shims in front of an rc file that prepends its own directory', () => {
    expect(spoken(bashResolves(`export PATH="${fakeBin}:$PATH"\n`))).toBe(join(shims, 'claude'));
  });

  it('still sources the user rc file it replaced', () => {
    const home = mkdtempSync(join(tmpdir(), 'atrium-home-'));
    writeFileSync(join(home, '.bashrc'), 'export ATRIUM_RC_RAN=yes\n');
    const out = execFileSync(
      '/bin/bash',
      ['--init-file', initFile, '-i', '-c', 'echo "$ATRIUM_RC_RAN"'],
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { HOME: home, TERM: 'dumb', PATH: '/usr/bin:/bin', ATRIUM_SHIM_DIR: shims },
      },
    );
    expect(spoken(out)).toBe('yes');
  });
});
