import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function raw(name: string, args: string[] = [], withState = true, input = ''): string {
  return execFileSync('/bin/bash', [join(shims, name), ...args], {
    encoding: 'utf8',
    input,
    env: {
      PATH: `${shims}:${fakeBin}:/usr/bin:/bin`,
      HOME: state,
      ...(withState ? { ATRIUM_SESSION_STATE: state } : {}),
    },
  }).trim();
}

/** The hook settings are on every claude invocation and tested on their own. */
function run(name: string, args: string[] = [], withState = true): string {
  return raw(name, args, withState).replace(/ --settings \S+/, '');
}

const armResume = (id: string, file = 'resume') => writeFileSync(join(state, file), id);
const currentId = () => readFileSync(join(state, 'current'), 'utf8').trim();

describe('Claude lifecycle hooks', () => {
  /**
   * The shim can see the command line and nothing else, which leaves it blind
   * to `claude --resume` with no id, to `--continue`, and to /resume inside a
   * session already running. The agent is never blind to those, so it is asked
   * instead of inferred from.
   */
  it('hands Claude the settings that make it say which conversation it is on', () => {
    expect(raw('claude')).toContain(`--settings ${join(shims, 'claude-settings.json')}`);

    const settings = JSON.parse(readFileSync(join(shims, 'claude-settings.json'), 'utf8'));
    expect(Object.keys(settings.hooks)).toEqual(['SessionStart']);
    // Claude only notifies terminals it knows by name. OSC 777 is one the tab reads.
    expect(settings.preferredNotifChannel).toBe('ghostty');
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain(join(shims, 'hook'));
  });

  /** Ours would replace theirs, and a flag that silently stops working is worse. */
  it('stands aside when the user brought their own settings', () => {
    expect(raw('claude', ['--settings', '/my/settings.json'])).not.toContain(
      join(shims, 'claude-settings.json'),
    );
  });

  const payload = (id: string) =>
    JSON.stringify({ session_id: id, hook_event_name: 'SessionStart', cwd: '/tmp' });

  it('records the conversation the agent says it is on', () => {
    raw('hook', [], true, payload('37ea38bf-39dd-4c33-a08a-798d9e04abf9'));
    expect(currentId()).toBe('37ea38bf-39dd-4c33-a08a-798d9e04abf9');
  });

  /** Claude blocks on the hook's stdout. A broken hook must not be a dead tab. */
  it('answers Claude even with nowhere to write and nothing to read', () => {
    expect(raw('hook', [], false, 'not json at all')).toBe('{}');
  });
});

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
  const NOTIFY =
    '-c tui.notifications=true -c tui.notification_method="osc9" ' +
    '-c tui.notification_condition="always"';

  /**
   * Codex only notifies in terminals it recognises, and only when it thinks
   * it is out of view. The tab decides that, so Codex is asked to always say.
   */
  it('asks Codex to notify the terminal, for this run only', () => {
    expect(run('codex', ['--model', 'gpt-5'])).toBe(`codex ${NOTIFY} --model gpt-5`);
  });

  it('reopens the thread Atrium armed it with, once', () => {
    armResume('thread-7', 'resume-codex');
    expect(run('codex')).toBe(`codex ${NOTIFY} resume thread-7`);
    expect(run('codex')).toBe(`codex ${NOTIFY}`);
  });

  it('stays out of the way of a subcommand', () => {
    armResume('thread-7', 'resume-codex');
    expect(run('codex', ['exec'])).toBe('codex exec');
  });
});

describe('the atrium command', () => {
  /** Run it as a program in a tab would, from `cwd`, and return what it wrote. */
  function atrium(args: string[], cwd: string, withState = true): { out: string; requests: string[] } {
    const out = execFileSync('/bin/bash', [join(shims, 'atrium'), ...args], {
      encoding: 'utf8',
      cwd,
      env: { PATH: '/usr/bin:/bin', HOME: state, ...(withState ? { ATRIUM_SESSION_STATE: state } : {}) },
    });
    const dir = join(state, 'requests');
    const requests = existsSync(dir)
      ? readdirSync(dir)
          .filter((name) => !name.startsWith('.'))
          .sort()
          .map((name) => readFileSync(join(dir, name), 'utf8'))
      : [];
    return { out, requests };
  }

  it('writes an open request, with a relative path made absolute where it ran', () => {
    const { requests } = atrium(['open', 'docs/plan.md'], state);
    expect(requests).toHaveLength(1);
    const [verb, path] = requests[0].split('\n');
    expect(verb).toBe('open');
    expect(path).toMatch(/^\/.*\/docs\/plan\.md$/);
  });

  it('passes a URL, an absolute path and a ~ path through as given', () => {
    atrium(['open', 'http://localhost:5173/'], state);
    atrium(['open', '/etc/hosts:12'], state);
    atrium(['open', '~/notes.md'], state);
    expect(atrium(['--help'], state).requests.map((r) => r.split('\n')[1])).toEqual([
      'http://localhost:5173/',
      '/etc/hosts:12',
      '~/notes.md',
    ]);
  });

  it('writes a diff request for where it ran, or for the path it is given', () => {
    const { requests } = atrium(['diff'], state);
    atrium(['diff', 'src/a.ts'], state);
    const all = atrium(['diff', '~/repo'], state).requests;
    expect(requests).toHaveLength(1);
    expect(all.map((r) => r.split('\n').slice(0, 2))).toEqual([
      ['diff', expect.stringMatching(/^\/.+/)],
      ['diff', expect.stringMatching(/^\/.*\/src\/a\.ts$/)],
      ['diff', '~/repo'],
    ]);
    expect(() => atrium(['diff', 'a', 'b'], state)).toThrow(/at most one path/);
  });

  it('writes a report as a key and a value on their own lines', () => {
    expect(atrium(['report', 'summary', 'migrating auth'], state).requests).toEqual([
      'report\nsummary\nmigrating auth\n',
    ]);
  });

  /** Nothing to talk to is an error an agent can read, not a silent no-op. */
  it('refuses outside an Atrium tab, and explains itself', () => {
    expect(() => atrium(['open', 'x'], state, false)).toThrow(/not inside an Atrium tab/);
    expect(() => atrium(['open'], state)).toThrow(/takes one path/);
    expect(() => atrium(['dance'], state)).toThrow(/unknown command/);
    const help = atrium(['--help'], state).out;
    expect(help).toContain('atrium open');
    expect(help).toContain('atrium report');
    expect(help).toContain('atrium diff');
    expect(existsSync(join(state, 'requests'))).toBe(false);
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
