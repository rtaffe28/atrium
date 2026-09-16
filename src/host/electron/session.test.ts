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

describe('capturing what is running in a tab', () => {
  it('records the full typed line when it matches the foreground process', async () => {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh');
    const { tabId } = firstTerminalTab(driver);

    // Type a command with arguments, then let the pty report what is running.
    for (const char of 'claude --continue') driver.write(tabId, char);
    driver.write(tabId, '\r');
    f.setForeground({ [tabId]: 'claude' });

    await driver.refreshCommands();

    const tab = driver.list()[0].tabs[tabId];
    // Arguments are the point: bare `claude` would start a new conversation.
    expect(tab.command).toBe('claude --continue');
    expect(tab.title).toBe('claude');
    driver.dispose();
  });

  it('trusts what was typed over a process that renamed itself', async () => {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh');
    const { tabId } = firstTerminalTab(driver);

    driver.write(tabId, 'claude\r');
    // Claude Code reports as its version. Trusting this name recorded
    // "2.1.273" as the command, and restore typed that into a shell.
    f.setForeground({ [tabId]: '2.1.273' });

    await driver.refreshCommands();
    const tab = driver.list()[0].tabs[tabId];
    expect(tab.command).toBe('claude');
    expect(tab.title).toBe('claude');
    driver.dispose();
  });

  it('prefers the wrapper that was typed over the process it spawned', async () => {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh');
    const { tabId } = firstTerminalTab(driver);

    driver.write(tabId, 'npm run dev\r');
    f.setForeground({ [tabId]: 'node' });

    await driver.refreshCommands();
    // Restoring `npm run dev` is useful; restoring bare `node` is not.
    expect(driver.list()[0].tabs[tabId].command).toBe('npm run dev');
    driver.dispose();
  });

  it('falls back to the process name for a tab nobody typed in', async () => {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh');
    const { tabId } = firstTerminalTab(driver);

    f.setForeground({ [tabId]: 'vim' });

    await driver.refreshCommands();
    expect(driver.list()[0].tabs[tabId].command).toBe('vim');
    driver.dispose();
  });

  it('records nothing when the process name could not be typed', async () => {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh');
    const { tabId } = firstTerminalTab(driver);

    f.setForeground({ [tabId]: '2.1.273' });

    await driver.refreshCommands();
    expect(driver.list()[0].tabs[tabId].command).toBeUndefined();
    driver.dispose();
  });

  it('records nothing for a tab that has only ever sat at a prompt', async () => {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh');
    const { tabId } = firstTerminalTab(driver);

    driver.write(tabId, 'echo hi\r');
    f.setForeground({ [tabId]: 'zsh' });

    await driver.refreshCommands();
    expect(driver.list()[0].tabs[tabId].command).toBeUndefined();
    driver.dispose();
  });

  /**
   * The tab has to remember what it was doing, not only what it is doing.
   * Exiting an agent and then quitting used to leave a bare shell on restore,
   * throwing away a conversation the tab still had the id for.
   */
  it('keeps the last command after the agent exits', async () => {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh');
    const { tabId } = firstTerminalTab(driver);

    driver.write(tabId, 'claude\r');
    f.setForeground({ [tabId]: 'claude' });
    await driver.refreshCommands();
    expect(driver.list()[0].tabs[tabId].command).toBe('claude');

    // The agent exits; the shell is idle again.
    f.setForeground({ [tabId]: 'zsh' });
    await driver.refreshCommands();

    const tab = driver.list()[0].tabs[tabId];
    expect(tab.command, 'restore needs this').toBe('claude');
    expect(tab.title, 'but the tab should stop claiming it is running').toBe('zsh');
    driver.dispose();
  });

  it('forgets a half-typed line when something interactive takes over', async () => {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh');
    const { tabId } = firstTerminalTab(driver);

    driver.write(tabId, 'clau');
    driver.write(tabId, '\x1b'); // an escape means this is not a command line
    driver.write(tabId, '\r');
    f.setForeground({ [tabId]: 'claude' });

    await driver.refreshCommands();
    expect(driver.list()[0].tabs[tabId].command).toBe('claude');
    driver.dispose();
  });
});

describe('restoring a captured command', () => {
  afterEach(() => vi.useRealTimers());

  it('types the command into a fresh shell, once its prompt has settled', async () => {
    vi.useFakeTimers();
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh', {
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
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh', {
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
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh');
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
