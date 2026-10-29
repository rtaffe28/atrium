import { describe, expect, it } from 'vitest';
import { rightNeighbor } from '../layout/tree';
import { MockDriver } from './mock';
import type { Session } from './types';

const find = (driver: MockDriver, id: string) => driver.list().find((s) => s.id === id)!;

function singlePane(driver: MockDriver): { session: Session; groupId: string } {
  const session = driver.list().find((s) => s.layout.type === 'leaf')!;
  return { session, groupId: Object.keys(session.groups)[0] };
}

const changesTabs = (session: Session) => Object.values(session.tabs).filter((t) => t.kind === 'diff');

describe('opening the changes beside a pane', () => {
  it('splits to the right with a changes tab on the folder', () => {
    const driver = new MockDriver();
    const { session, groupId } = singlePane(driver);

    driver.openChangesBeside(session.id, groupId, '/repo');

    const after = find(driver, session.id);
    const right = rightNeighbor(after.layout, groupId)!;
    const tab = after.tabs[after.groups[right].activeTabId!];
    expect(tab).toMatchObject({ kind: 'diff', root: '/repo', title: 'Changes' });
    expect(tab.path).toBeUndefined();
  });

  it('raises the one already open for the repository, moved to the file asked for', () => {
    const driver = new MockDriver();
    const { session, groupId } = singlePane(driver);
    driver.openChangesBeside(session.id, groupId, '/repo');
    // Another tab in front of it, then a request from a subfolder of the same repository.
    driver.openLinkBeside(session.id, groupId, 'https://a.test');
    driver.openChangesBeside(session.id, groupId, '/repo/src', '/repo/src/a.ts');

    const after = find(driver, session.id);
    const tabs = changesTabs(after);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ root: '/repo', path: '/repo/src/a.ts' });
    const right = rightNeighbor(after.layout, groupId)!;
    expect(after.groups[right].activeTabId).toBe(tabs[0].id);
  });

  it('opens a second for a different repository', () => {
    const driver = new MockDriver();
    const { session, groupId } = singlePane(driver);
    driver.openChangesBeside(session.id, groupId, '/repo');
    driver.openChangesBeside(session.id, groupId, '/other');
    expect(changesTabs(find(driver, session.id))).toHaveLength(2);
  });

  it('acts on `atrium diff` from a program in a tab', () => {
    const driver = new MockDriver();
    const { session, groupId } = singlePane(driver);
    const tabId = session.groups[groupId].tabIds[0];

    driver.receiveRequest(tabId, { verb: 'diff', root: '/repo', path: '/repo/a.ts' });

    expect(changesTabs(find(driver, session.id))[0]).toMatchObject({ root: '/repo', path: '/repo/a.ts' });
  });
});

describe('the rail\'s +/−', () => {
  it('takes what git said, and changes nothing when it says the same again', () => {
    const driver = new MockDriver();
    const { session } = singlePane(driver);
    let updates = 0;
    driver.subscribe(() => updates++);
    const before = updates;

    driver.setDiffStat(session.id, { files: 2, added: 10, removed: 3 });
    driver.setDiffStat(session.id, { files: 2, added: 10, removed: 3 });

    expect(find(driver, session.id).diff).toEqual({ files: 2, added: 10, removed: 3 });
    expect(updates - before).toBe(1);
  });
});
