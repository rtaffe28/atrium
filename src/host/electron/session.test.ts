import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElectronSessionDriver } from './session';
import type { AtriumBridge } from './bridge';

/** A bridge that records calls and lets a test decide what is running. */
function fakeBridge() {
  let foreground: Record<string, string> = {};
  let report: { sessionId: string | null } = { sessionId: null };
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
      report: vi.fn(async () => report),
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
    setReport: (next: { sessionId?: string }) => {
      report = { sessionId: null, ...next };
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

  /**
   * Claude files a conversation under the directory it ran in, so a tab that
   * comes back somewhere else cannot resume it however good the id is.
   */
  it('reopens a tab where it was, not where the session was opened', () => {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh', STATE);
    const saved = driver.snapshot();
    const tabId = Object.keys(saved[0].tabs)[0];
    saved[0].cwd = '/Users/ryan';
    saved[0].tabs[tabId].cwd = '/Users/ryan/git/atrium';

    for (const session of driver.list()) driver.killSession(session.id);
    f.spawned.length = 0;
    driver.hydrate(saved, {});

    expect(f.spawned.find((s) => s.id === tabId)?.cwd).toBe('/Users/ryan/git/atrium');
    driver.dispose();
  });

  /**
   * `claude --resume` with no id opens a picker, and `/resume` switches inside
   * a running process. Neither reaches the shim, so a tab that only trusted
   * the shim kept arming the conversation you had left behind. The agent's own
   * SessionStart hook fires for all of them.
   */
  it('follows the user into a conversation they resumed themselves', async () => {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh', STATE);
    const { tabId } = firstTerminalTab(driver);

    f.setForeground({ [tabId]: '2.1.273' });
    f.setReport({ sessionId: '62501422-cc78-44a5-87cb-00f03cf9df28' });
    await driver.refreshCommands();

    expect(driver.list()[0].tabs[tabId].agentSessionId).toBe(
      '62501422-cc78-44a5-87cb-00f03cf9df28',
    );
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
