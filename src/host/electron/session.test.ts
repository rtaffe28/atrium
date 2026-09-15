import { describe, expect, it, vi } from 'vitest';
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

  it('falls back to the process name when the typed line does not match', async () => {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh');
    const { tabId } = firstTerminalTab(driver);

    driver.write(tabId, 'ls\r');
    f.setForeground({ [tabId]: 'vim' }); // opened some other way

    await driver.refreshCommands();
    expect(driver.list()[0].tabs[tabId].command).toBe('vim');
    driver.dispose();
  });

  it('records nothing while the tab is just sitting at a shell prompt', async () => {
    const f = fakeBridge();
    const driver = new ElectronSessionDriver(f.bridge, '/Users/ryan', '/bin/zsh');
    const { tabId } = firstTerminalTab(driver);

    driver.write(tabId, 'echo hi\r');
    f.setForeground({ [tabId]: 'zsh' });

    await driver.refreshCommands();
    expect(driver.list()[0].tabs[tabId].command).toBeUndefined();
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
  it('types the command into a fresh shell instead of replacing it', async () => {
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

    // The command is typed once the shell has shown it is alive.
    f.emit('t1', '~/work % ');
    expect(f.written).toEqual([{ id: 't1', data: 'claude --continue\r' }]);
    driver.dispose();
  });
});
