import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElectronSessionDriver } from './session';
import type { AtriumBridge } from './bridge';

/** A bridge that records calls and lets a test decide what is running. */
function fakeBridge() {
  let foreground: Record<string, string> = {};
  const spawned: Array<{ id: string; cwd: string }> = [];
  const written: Array<{ id: string; data: string }> = [];
  let onData: ((id: string, data: string) => void) | null = null;

  const bridge = {
    info: vi.fn(),
    pty: {
      spawn: vi.fn(async (options: { id: string; cwd: string }) => {
        spawned.push({ id: options.id, cwd: options.cwd });
        return { pid: 1 };
      }),
      replay: vi.fn(async () => ''),
      foreground: vi.fn(async () => foreground),
      write: vi.fn((id: string, data: string) => written.push({ id, data })),
      resize: vi.fn(),
      interrupt: vi.fn(),
      kill: vi.fn(),
      onData: (handler: (id: string, data: string) => void) => {
        onData = handler;
        return () => {};
      },
      onExit: () => () => {},
    },
    agent: {
      prepareSession: vi.fn(async () => '/tmp/state'),
      currentSession: vi.fn(async () => null),
      newestCodexSession: vi.fn(async () => null),
    },
    notify: { post: vi.fn() },
    workspace: { load: vi.fn(), save: vi.fn() },
    window: { onState: () => () => {} },
  } as unknown as AtriumBridge;

  return {
    bridge,
    spawned,
    written,
    emit: (id: string, data: string) => onData?.(id, data),
    setForeground: (f: Record<string, string>) => {
      foreground = f;
    },
  };
}

function firstTerminalTab(driver: ElectronSessionDriver) {
  const session = driver.list()[0];
  return { session, tabId: Object.keys(session.tabs)[0] };
}

/** Reported by the main process, never rebuilt from the home directory. */
const STATE = '/Users/ryan/Library/Application Support/atrium/sessions';

const ESC = '\x1b';
const osc = (body: string) => `${ESC}]${body}\x07`;

describe('what a tab is running, as reported by the shell', () => {
  /**
   * This used to be inferred, and was wrong in practice: the pty's foreground
   * process lies when a process renames itself — Claude Code reports as its
   * own version, and "2.1.273" was once recorded as a tab's command.
   */
  it('records the command line the shell announced, verbatim', async () => {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh', STATE);
    const { tabId } = firstTerminalTab(driver);

    f.emit(tabId, osc('633;E;claude --dangerously-skip-permissions'));

    const tab = driver.list()[0].tabs[tabId];
    expect(tab.command).toBe('claude --dangerously-skip-permissions');
    expect(tab.title).toBe('claude');
    driver.dispose();
  });

  it('returns the title to the shell when the command finishes', async () => {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh', STATE);
    const { tabId } = firstTerminalTab(driver);

    f.emit(tabId, osc('633;E;npm run dev'));
    expect(driver.list()[0].tabs[tabId].title).toBe('npm');

    f.emit(tabId, osc('133;D;0'));
    const tab = driver.list()[0].tabs[tabId];
    expect(tab.title, 'idle again').toBe('zsh');
    // But the command stays: it is what a restore has to go on.
    expect(tab.command, 'restore needs this').toBe('npm run dev');
    driver.dispose();
  });

  /**
   * The session's own cwd is where it was opened. A new session inheriting
   * that puts you back where you started rather than where you are.
   */
  it('follows the shell into a new directory', () => {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh', STATE);
    const { tabId } = firstTerminalTab(driver);

    f.emit(tabId, osc('633;P;Cwd=/Users/ryan/git/atrium'));
    expect(driver.list()[0].tabs[tabId].cwd).toBe('/Users/ryan/git/atrium');

    f.emit(tabId, osc('633;P;Cwd=/Users/ryan/git/atrium/src'));
    expect(driver.list()[0].tabs[tabId].cwd).toBe('/Users/ryan/git/atrium/src');
    driver.dispose();
  });

  /** It arrives on every prompt; unchanged must not mean a workspace write. */
  it('does not touch the session when the directory has not changed', () => {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh', STATE);
    const { tabId } = firstTerminalTab(driver);

    f.emit(tabId, osc('633;P;Cwd=/Users/ryan/git/atrium'));
    const before = driver.list()[0];

    f.emit(tabId, osc('633;P;Cwd=/Users/ryan/git/atrium'));
    expect(driver.list()[0]).toBe(before);
    driver.dispose();
  });

  it('is unbothered by a command line containing semicolons', async () => {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh', STATE);
    const { tabId } = firstTerminalTab(driver);

    f.emit(tabId, osc('633;E;a; b; c'));
    expect(driver.list()[0].tabs[tabId].command).toBe('a; b; c');
    driver.dispose();
  });
});

describe('restoring a captured command', () => {
  afterEach(() => vi.useRealTimers());

  it('types the command into a fresh shell, once its prompt has settled', async () => {
    vi.useFakeTimers();
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh', STATE, {
      sessions: [
        {
          id: 's1',
          title: 'claude',
          cwd: '~/work',
          branch: 'main',
          createdAt: 1,
          diff: { files: 0, added: 0, removed: 0 },
          layout: { type: 'leaf', groupId: 'g1' },
          groups: { g1: { id: 'g1', tabIds: ['t1'], activeTabId: 't1' } },
          tabs: {
            t1: { id: 't1', kind: 'terminal', title: 'claude', command: 'claude --continue' },
          },
        },
      ],
      scrollback: {},
    });

    // A shell, not the command — so the tab survives the command exiting.
    expect(f.spawned).toEqual([{ id: 't1', cwd: '/Users/ryan/work' }]);
    expect(f.written).toHaveLength(0);

    // The first chunk is often a partial line, not a prompt — typing then gets
    // mangled by a line editor that is not ready yet.
    f.emit('t1', '\x1b[1m%\x1b[0m');
    vi.advanceTimersByTime(200);
    expect(f.written, 'must not type into a shell that is still printing').toHaveLength(0);

    // More output restarts the clock.
    f.emit('t1', '~/work % ');
    vi.advanceTimersByTime(200);
    expect(f.written).toHaveLength(0);

    // Once it goes quiet, the command goes in.
    vi.advanceTimersByTime(200);
    expect(f.written).toEqual([{ id: 't1', data: 'claude --continue\r' }]);
    driver.dispose();
  });

  it('clears the screen between restored history and the new session', () => {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh', STATE, {
      sessions: [
        {
          id: 's1', title: 'claude', cwd: '~', branch: 'main', createdAt: 1,
          diff: { files: 0, added: 0, removed: 0 },
          layout: { type: 'leaf', groupId: 'g1' },
          groups: { g1: { id: 'g1', tabIds: ['t1'], activeTabId: 't1' } },
          tabs: { t1: { id: 't1', kind: 'terminal', title: 'claude', command: 'claude' } },
        },
      ],
      scrollback: { t1: 'output from last time' },
    });

    let replayed = '';
    driver.attach('t1', (chunk) => {
      replayed += chunk;
    });

    expect(replayed).toContain('output from last time');
    // Home, then erase the viewport — but not ESC[3J, which would take the
    // scrollback with it.
    expect(replayed).toContain('\x1b[H\x1b[2J');
    expect(replayed).not.toContain('\x1b[3J');
    expect(replayed.indexOf('output'), 'history first, then the clear').toBeLessThan(
      replayed.indexOf('\x1b[2J'),
    );
    driver.dispose();
  });

  it('sanitises replayed scrollback so it cannot re-answer terminal queries', () => {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh', STATE);
    const { tabId } = firstTerminalTab(driver);

    // A device-attributes query and focus-reporting mode, as a real agent
    // leaves behind in its output.
    f.emit(tabId, `before\x1b[c\x1b[?1004hafter`);

    let replayed = '';
    driver.attach(tabId, (chunk) => {
      replayed += chunk;
    });

    expect(replayed).toContain('before');
    expect(replayed).toContain('after');
    expect(replayed, 'a replayed query would be answered into the shell').not.toContain('\x1b[c');
    expect(replayed, 'a replayed mode would re-arm focus reporting').not.toContain('[?1004h');
    driver.dispose();
  });
});

/**
 * The bug this covers: a pty echoes, so typing produced output, and output is
 * the evidence that an agent is working. Typing into a tab made the rail claim
 * the agent was busy, and pausing rang the "finished" chime for work nobody
 * had started.
 *
 * The wider weakness this only narrows — output is a poor proxy for progress,
 * and a spinner still reads as work — is recorded in
 * docs/plan/active/12-agent-state.md.
 */
describe('typing is not the agent working', () => {
  afterEach(() => vi.useRealTimers());

  /** A restored agent tab, past the point where its command is typed in. */
  function agentTab() {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh', STATE, {
      sessions: [
        {
          id: 's1',
          title: 'claude',
          cwd: '~/work',
          branch: 'main',
          createdAt: 1,
          diff: { files: 0, added: 0, removed: 0 },
          layout: { type: 'leaf', groupId: 'g1' },
          groups: { g1: { id: 'g1', tabIds: ['t1'], activeTabId: 't1' } },
          tabs: { t1: { id: 't1', kind: 'terminal', title: 'claude', command: 'claude' } },
        },
      ],
      scrollback: {},
    });
    const state = () => driver.list()[0].tabs.t1.agentState;
    return { f, driver, state };
  }

  it('stays quiet while a keystroke echoes back', () => {
    vi.useFakeTimers();
    const { f, driver, state } = agentTab();

    driver.write('t1', 'h');
    f.emit('t1', 'h');
    expect(state(), 'an echo is not the agent doing anything').toBeUndefined();

    // And the settle clock was never started, so nothing announces a finish.
    vi.advanceTimersByTime(5000);
    expect(state()).toBeUndefined();
    driver.dispose();
  });

  it('counts the line once it is submitted', () => {
    vi.useFakeTimers();
    const { f, driver, state } = agentTab();

    driver.write('t1', 'fix the tests');
    f.emit('t1', 'fix the tests');
    expect(state()).toBeUndefined();

    driver.write('t1', '\r');
    f.emit('t1', 'thinking...');
    expect(state(), 'submitting is what starts the work').toBe('working');

    vi.advanceTimersByTime(2000);
    expect(state()).toBe('done');
    driver.dispose();
  });

  it('keeps saying "needs you" until the answer is actually sent', () => {
    vi.useFakeTimers();
    const { f, driver, state } = agentTab();

    f.emit('t1', '\x07');
    expect(state()).toBe('waiting');

    driver.write('t1', 'y');
    f.emit('t1', 'y');
    expect(state(), 'a half-typed answer is still no answer').toBe('waiting');

    driver.write('t1', '\r');
    expect(state()).toBe('working');
    driver.dispose();
  });

  it('lets real output through once the echo window has passed', () => {
    vi.useFakeTimers();
    const { f, driver, state } = agentTab();

    driver.write('t1', 'x');
    vi.advanceTimersByTime(400);
    f.emit('t1', 'the agent, unprompted');
    expect(state()).toBe('working');
    driver.dispose();
  });

  it('prefers the shell reporting an exit over the settle clock', () => {
    vi.useFakeTimers();
    const { f, driver, state } = agentTab();

    driver.write('t1', '\r');
    f.emit('t1', 'building...');
    expect(state()).toBe('working');

    f.emit('t1', osc('133;D;1'));
    expect(state(), 'a reported failure, not a guessed finish').toBe('error');

    // The settle clock must not fire behind it and overwrite the report.
    vi.advanceTimersByTime(5000);
    expect(state()).toBe('error');
    driver.dispose();
  });
});
