import { describe, expect, it } from 'vitest';
import { leafGroupIds } from '../layout/tree';
import { SessionStore } from './store';
import type { DataHandler, Session, Unsubscribe } from './types';

class BareStore extends SessionStore {
  protected openTerminal(): void {}
  protected closeTerminal(): void {}
  attach(_tabId: string, _onData: DataHandler): Unsubscribe {
    return () => {};
  }
  write(): void {}
  resize(): void {}
  interrupt(): void {}
}

const tab = (id: string) => ({ id, kind: 'terminal' as const, title: id });

function base(overrides: Partial<Session>): Session {
  return {
    id: 'sX',
    title: 'Damaged',
    cwd: '~',
    branch: 'main',
    createdAt: 1,
    diff: { files: 0, added: 0, removed: 0 },
    layout: { type: 'leaf', groupId: 'gA' },
    groups: { gA: { id: 'gA', tabIds: ['tA'], activeTabId: 'tA' } },
    tabs: { tA: tab('tA') },
    ...overrides,
  };
}

/**
 * A workspace file written by a buggy build outlives the bug, so restore has
 * to repair one rather than trust it. Every case here is checked against the
 * same rule: a terminal must never be dropped, even if its pane must be.
 */
describe('restoring a damaged workspace', () => {
  it('rescues tabs from a group that is not in the layout', () => {
    const store = new BareStore();
    store.hydrate(
      [
        base({
          layout: { type: 'leaf', groupId: 'gA' },
          groups: {
            gA: { id: 'gA', tabIds: ['tA'], activeTabId: 'tA' },
            gGhost: { id: 'gGhost', tabIds: ['tB'], activeTabId: 'tB' },
          },
          tabs: { tA: tab('tA'), tB: tab('tB') },
        }),
      ],
      {},
    );

    const session = store.list()[0];
    expect(Object.values(session.groups).flatMap((g) => g.tabIds).sort()).toEqual(['tA', 'tB']);
    expect(leafGroupIds(session.layout)).toEqual(Object.keys(session.groups));
  });

  it('drops a pane whose group is missing', () => {
    const store = new BareStore();
    store.hydrate(
      [
        base({
          layout: {
            type: 'split',
            direction: 'row',
            sizes: [0.5, 0.5],
            children: [
              { type: 'leaf', groupId: 'gA' },
              { type: 'leaf', groupId: 'gMissing' },
            ],
          },
        }),
      ],
      {},
    );

    const session = store.list()[0];
    expect(leafGroupIds(session.layout)).toEqual(['gA']);
    expect(Object.keys(session.tabs)).toEqual(['tA']);
  });

  it('re-homes a tab that is in no pane', () => {
    const store = new BareStore();
    store.hydrate([base({ tabs: { tA: tab('tA'), tLost: tab('tLost') } })], {});

    const session = store.list()[0];
    expect(Object.values(session.groups).flatMap((g) => g.tabIds).sort()).toEqual(['tA', 'tLost']);
  });

  it('forgets a pane reference to a tab that no longer exists', () => {
    const store = new BareStore();
    store.hydrate(
      [base({ groups: { gA: { id: 'gA', tabIds: ['tA', 'tGone'], activeTabId: 'tGone' } } })],
      {},
    );

    const session = store.list()[0];
    expect(session.groups.gA.tabIds).toEqual(['tA']);
    expect(session.groups.gA.activeTabId, 'active tab must point at a real tab').toBe('tA');
  });

  it('rebuilds a single pane when the layout is unusable', () => {
    const store = new BareStore();
    store.hydrate(
      [
        base({
          layout: { type: 'leaf', groupId: 'gNowhere' },
          groups: {},
          tabs: { tA: tab('tA'), tB: tab('tB') },
        }),
      ],
      {},
    );

    const session = store.list()[0];
    expect(leafGroupIds(session.layout)).toHaveLength(1);
    expect(Object.values(session.groups).flatMap((g) => g.tabIds).sort()).toEqual(['tA', 'tB']);
  });
});
