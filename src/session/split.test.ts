import { describe, expect, it } from 'vitest';
import { leafGroupIds } from '../layout/tree';
import { MockDriver } from './mock';
import type { DropAction, Session } from './types';

/**
 * The invariant a lost tab violates.
 *
 * Every group must appear exactly once as a leaf of the layout tree, and every
 * leaf must have a group. A group that exists in `groups` but not in `layout`
 * still holds its tabs — they are simply never rendered, which reads to the
 * user as the tab having been deleted.
 */
function checkIntegrity(session: Session, label: string) {
  const leaves = leafGroupIds(session.layout);
  const groupIds = Object.keys(session.groups);

  expect(new Set(leaves).size, `${label}: duplicate leaf in layout`).toBe(leaves.length);
  expect([...leaves].sort(), `${label}: layout leaves vs groups`).toEqual([...groupIds].sort());

  const tabsInGroups = groupIds.flatMap((g) => session.groups[g].tabIds).sort();
  const tabsInMap = Object.keys(session.tabs).sort();
  expect(tabsInGroups, `${label}: tabs referenced by groups vs tabs map`).toEqual(tabsInMap);
}

function twoTabSession(driver: MockDriver) {
  return driver.list().find((s) => Object.keys(s.tabs).length === 2)!;
}

describe('splitting never loses a tab', () => {
  it('holds through a single split', () => {
    const driver = new MockDriver();
    const session = twoTabSession(driver);
    const groupId = Object.keys(session.groups)[0];
    const tabId = session.groups[groupId].tabIds[1];

    driver.moveTab(session.id, tabId, { kind: 'split', groupId, edge: 'right' });
    checkIntegrity(driver.list().find((s) => s.id === session.id)!, 'after one split');
  });

  it('holds when the same tab is split again into the other pane', () => {
    const driver = new MockDriver();
    const session = twoTabSession(driver);
    const groupId = Object.keys(session.groups)[0];
    const tabId = session.groups[groupId].tabIds[1];

    driver.moveTab(session.id, tabId, { kind: 'split', groupId, edge: 'right' });

    const after = driver.list().find((s) => s.id === session.id)!;
    const otherGroup = Object.keys(after.groups).find((g) => g !== groupId)!;
    // Drag it back at the far pane — the classic "undo my split" gesture.
    driver.moveTab(session.id, tabId, { kind: 'split', groupId: otherGroup, edge: 'left' });

    checkIntegrity(driver.list().find((s) => s.id === session.id)!, 'after second split');
    expect(Object.keys(driver.list().find((s) => s.id === session.id)!.tabs)).toHaveLength(2);
  });

  it('survives a long run of random drags without losing a tab', () => {
    const driver = new MockDriver();
    const session = twoTabSession(driver);
    const startingTabs = Object.keys(session.tabs).length;

    const edges = ['left', 'right', 'top', 'bottom'] as const;
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };

    for (let i = 0; i < 200; i++) {
      const current = driver.list().find((s) => s.id === session.id);
      if (!current) break;

      const groupIds = Object.keys(current.groups);
      const tabIds = Object.keys(current.tabs);
      const tabId = tabIds[rand(tabIds.length)];
      const groupId = groupIds[rand(groupIds.length)];

      const action: DropAction =
        rand(2) === 0
          ? { kind: 'split', groupId, edge: edges[rand(edges.length)] }
          : { kind: 'tabbar', groupId, index: rand(3) };

      driver.moveTab(session.id, tabId, action);
      checkIntegrity(driver.list().find((s) => s.id === session.id)!, `drag ${i}`);
      expect(
        Object.keys(driver.list().find((s) => s.id === session.id)!.tabs).length,
        `drag ${i}: tab count changed`,
      ).toBe(startingTabs);
    }
  });
});

describe('a tab dropped on the rail', () => {
  it('leaves the session it came from entirely, and keeps the one it makes whole', () => {
    const driver = new MockDriver();
    const session = twoTabSession(driver);
    const groupId = Object.keys(session.groups)[0];
    const tabId = session.groups[groupId].tabIds[1];

    driver.moveTab(session.id, tabId, { kind: 'rail' });

    const source = driver.list().find((s) => s.id === session.id)!;
    expect(source.tabs[tabId], 'still in the old session').toBeUndefined();
    checkIntegrity(source, 'old session');
    const created = driver.list().find((s) => s.id !== session.id && s.tabs[tabId])!;
    expect(created).toBeDefined();
    checkIntegrity(created, 'new session');
  });
});
