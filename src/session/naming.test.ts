import { describe, expect, it } from 'vitest';
import { SessionStore } from './store';
import type { DataHandler, Unsubscribe } from './types';

/** A store whose terminals print whatever a test hands them. */
class FedStore extends SessionStore {
  protected openTerminal(): void {}
  protected closeTerminal(): void {}
  attach(_tabId: string, _onData: DataHandler): Unsubscribe {
    return () => {};
  }
  write(): void {}
  resize(): void {}
  interrupt(): void {}
  /** What the program in the tab printed. */
  feed(tabId: string, chunk: string): void {
    this.receiveSignals(tabId, chunk);
  }
}

const osc = (body: string) => `\x1b]${body}\x07`;
const title = (text: string) => osc(`2;${text}`);
/** The shell's mark for a command that has exited. */
const exited = osc('133;D;0');

function open(command = 'claude') {
  const store = new FedStore();
  const session = store.createSession({ title: command, cwd: '~', branch: 'main', command });
  const tabId = Object.keys(session.tabs)[0];
  return { store, id: session.id, tabId, name: () => store.list()[0].title };
}

/** The same workspace, as the next launch would see it. */
function restored(store: FedStore) {
  const next = new FedStore();
  next.hydrate(store.snapshot(), {});
  return next;
}

describe("a session's name", () => {
  it('is what the program working in it calls itself', () => {
    const { store, tabId, name } = open();
    expect(name()).toBe('claude');

    store.feed(tabId, title('◐ Fix the bug'));

    expect(name()).toBe('Fix the bug');
  });

  it('follows the program when it changes its mind, not when it only spins', () => {
    const { store, tabId, name } = open();
    store.feed(tabId, title('◐ Fix the bug'));
    let renders = 0;
    store.subscribe(() => renders++);

    store.feed(tabId, title('◑ Fix the bug'));
    expect(name()).toBe('Fix the bug');
    // The frame changed the tab's title and nothing else.
    expect(renders).toBe(2);

    store.feed(tabId, title('◒ Fix the bug and its test'));
    expect(name()).toBe('Fix the bug and its test');
  });

  it('outlasts the title: kept when the program goes idle, exits, and is restored', () => {
    const { store, tabId, name } = open();
    store.feed(tabId, title('◐ Fix the bug'));

    store.feed(tabId, title('✳ Fix the bug'));
    expect(name(), 'idle').toBe('Fix the bug');

    store.feed(tabId, exited);
    expect(store.list()[0].tabs[tabId].programTitle).toBeUndefined();
    expect(name(), 'exited').toBe('Fix the bug');

    expect(restored(store).list()[0].title, 'restored').toBe('Fix the bug');
  });

  it('is not a title nothing is working under', () => {
    const { store, tabId, name } = open();

    // The shell's own title, set at its prompt, says where it is, not what
    // the session is for.
    store.feed(tabId, title('~/git/atrium'));
    expect(name()).toBe('claude');

    // Nor does it take over from the agent once the agent has exited.
    store.feed(tabId, title('◐ Fix the bug'));
    store.feed(tabId, exited);
    store.feed(tabId, title('~/git/atrium'));
    expect(name()).toBe('Fix the bug');
  });

  it('is never blank', () => {
    const { store, tabId, name } = open();
    store.feed(tabId, title('◐ '));
    expect(name()).toBe('claude');
  });

  it('is the one the user gave, once they have given one', () => {
    const { store, id, tabId, name } = open();
    store.feed(tabId, title('◐ Fix the bug'));

    store.renameSession(id, 'Bug 412');
    store.feed(tabId, title('◐ Fix the bug and its test'));
    expect(name()).toBe('Bug 412');

    // Still theirs after a restart.
    const next = restored(store);
    next.feed(tabId, title('◐ Something else'));
    expect(next.list()[0].title).toBe('Bug 412');
  });

  it('is handed to a tab pulled out onto the rail, and follows its program from there', () => {
    const { store, id, name } = open();
    const groupId = Object.keys(store.list()[0].groups)[0];
    const second = store.addTab(id, groupId, 'terminal');
    store.renameSession(id, 'Bug 412');

    store.moveTab(id, second.id, { kind: 'rail' });

    const created = store.list().find((s) => s.tabs[second.id])!;
    expect(created.named).toBeUndefined();
    store.feed(second.id, title('◐ Try the other approach'));
    expect(store.list().find((s) => s.id === created.id)?.title).toBe('Try the other approach');
    expect(name()).toBe('Bug 412');
  });
});
