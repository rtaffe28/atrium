import { describe, expect, it } from 'vitest';
import { leafGroupIds } from '../layout/tree';
import { SessionStore } from './store';
import type { DataHandler, Session, Unsubscribe } from './types';

/**
 * A store that restores without seeding first — the Electron path, and the
 * only one where the id counter is still at zero when foreign ids arrive.
 * MockDriver always seeds, which is why its tests never saw this.
 */
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

function savedWorkspace(n: (suffix: string) => string): Session[] {
  return [
    {
      id: n('s'),
      title: 'Restored',
      cwd: '~',
      branch: 'main',
      createdAt: 1,
      diff: { files: 0, added: 0, removed: 0 },
      layout: { type: 'leaf', groupId: n('g') },
      groups: { [n('g')]: { id: n('g'), tabIds: [n('t'), `${n('t')}b`], activeTabId: n('t') } },
      tabs: {
        [n('t')]: { id: n('t'), kind: 'terminal', title: 'claude', agent: 'claude' },
        [`${n('t')}b`]: { id: `${n('t')}b`, kind: 'terminal', title: 'zsh' },
      },
    },
  ];
}

const maxSuffix = (ids: string[]) =>
  Math.max(...ids.map((id) => Number(id.replace(/^[^0-9]*/, '').replace(/\D.*$/, '')) || 0));

describe('ids after a restore', () => {
  /**
   * MUST RUN FIRST. `counter` is module-global and only ever increases, so
   * this is the one test that observes it at zero — which is the exact
   * condition a real restart creates. Verified to fail without the fix in
   * store.ts: the split produced a single group used as both panes.
   */
  it('does not mint an id the restored workspace already uses', () => {
    const store = new BareStore();
    store.hydrate(savedWorkspace((p) => `${p}1`), {});
    store.moveTab('s1', 't1b', { kind: 'split', groupId: 'g1', edge: 'right' });

    const session = store.list()[0];
    const leaves = leafGroupIds(session.layout);

    expect(new Set(leaves).size, 'two panes must be two distinct groups').toBe(leaves.length);
    expect(leaves).toHaveLength(2);
    expect(Object.values(session.groups).flatMap((g) => g.tabIds).sort()).toEqual(['t1', 't1b']);
  });

  /**
   * Order-independent: ids are far above anything the counter could have
   * reached, so these assert the reservation contract directly rather than
   * relying on a collision that may or may not be reachable by then.
   */
  it('advances the counter past every restored id', () => {
    const store = new BareStore();
    store.hydrate(savedWorkspace((p) => `${p}900`), {});

    const created = store.addTab('s900', 'g900', 'terminal');
    expect(maxSuffix([created.id])).toBeGreaterThan(900);
  });

  it('keeps every tab in a pane when a restored session is split', () => {
    const store = new BareStore();
    store.hydrate(savedWorkspace((p) => `${p}800`), {});
    store.moveTab('s800', 't800b', { kind: 'split', groupId: 'g800', edge: 'bottom' });

    const session = store.list()[0];
    expect(Object.values(session.groups).flatMap((g) => g.tabIds).sort()).toEqual([
      't800',
      't800b',
    ]);
    expect(leafGroupIds(session.layout)).toHaveLength(2);
  });
});
