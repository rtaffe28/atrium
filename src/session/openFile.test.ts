import { describe, expect, it } from 'vitest';
import { rightNeighbor } from '../layout/tree';
import { MockDriver } from './mock';
import { titleFromPath } from './store';
import type { LayoutNode, Session } from './types';

const find = (driver: MockDriver, id: string) => driver.list().find((s) => s.id === id)!;

function singlePane(driver: MockDriver): { session: Session; groupId: string } {
  const session = driver.list().find((s) => s.layout.type === 'leaf')!;
  return { session, groupId: Object.keys(session.groups)[0] };
}

const fileTabs = (session: Session) => Object.values(session.tabs).filter((t) => t.kind === 'file');

describe('opening a file beside a pane', () => {
  it('splits to the right with a file tab, named after the file', () => {
    const driver = new MockDriver();
    const { session, groupId } = singlePane(driver);

    driver.openFileBeside(session.id, groupId, { kind: 'file', path: '/repo/src/a.ts', line: 12 });

    const after = find(driver, session.id);
    expect(after.layout.type).toBe('split');
    const layout = after.layout as Extract<LayoutNode, { type: 'split' }>;
    expect(layout.direction).toBe('row');
    const right = (layout.children[1] as { groupId: string }).groupId;
    const tab = after.tabs[after.groups[right].activeTabId!];
    expect(tab).toMatchObject({ kind: 'file', path: '/repo/src/a.ts', title: 'a.ts', line: 12 });
    expect(tab.root).toBeUndefined();
  });

  it('reuses the pane to the right, as a link does', () => {
    const driver = new MockDriver();
    const { session, groupId } = singlePane(driver);
    driver.openLinkBeside(session.id, groupId, 'https://a.test');
    driver.openFileBeside(session.id, groupId, { kind: 'file', path: '/repo/b.md' });

    const after = find(driver, session.id);
    const right = rightNeighbor(after.layout, groupId)!;
    expect(after.groups[right].tabIds.map((id) => after.tabs[id].kind)).toEqual(['browser', 'file']);
  });

  it('raises a tab already on the file instead of opening another', () => {
    const driver = new MockDriver();
    const { session, groupId } = singlePane(driver);
    driver.openFileBeside(session.id, groupId, { kind: 'file', path: '/repo/a.ts' });
    driver.openLinkBeside(session.id, groupId, 'https://a.test');
    driver.openFileBeside(session.id, groupId, { kind: 'file', path: '/repo/a.ts', line: 3 });

    const after = find(driver, session.id);
    const files = fileTabs(after);
    expect(files).toHaveLength(1);
    expect(files[0].line).toBe(3);
    const right = rightNeighbor(after.layout, groupId)!;
    expect(after.groups[right].activeTabId).toBe(files[0].id);
  });

  it('opens a folder as a tab with a tree and no file', () => {
    const driver = new MockDriver();
    const { session, groupId } = singlePane(driver);
    driver.openFileBeside(session.id, groupId, { kind: 'folder', root: '/repo/docs' });
    driver.openFileBeside(session.id, groupId, { kind: 'folder', root: '/repo/docs' });

    const files = fileTabs(find(driver, session.id));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ root: '/repo/docs', title: 'docs' });
    expect(files[0].path).toBeUndefined();
  });

  it('ignores a pane that no longer exists', () => {
    const driver = new MockDriver();
    const { session } = singlePane(driver);
    driver.openFileBeside(session.id, 'g-gone', { kind: 'file', path: '/repo/a.ts' });
    expect(find(driver, session.id)).toEqual(session);
  });
});

describe('opening a file in a pane', () => {
  it('adds the tab to the pane itself and makes it active', () => {
    const driver = new MockDriver();
    const { session, groupId } = singlePane(driver);
    const tab = driver.openFileIn(session.id, groupId, { kind: 'file', path: '/repo/a.ts' })!;

    const after = find(driver, session.id);
    expect(after.layout.type).toBe('leaf');
    expect(after.groups[groupId].activeTabId).toBe(tab.id);
    expect(driver.openFileIn(session.id, groupId, { kind: 'file', path: '/repo/a.ts' })).toBe(
      find(driver, session.id).tabs[tab.id],
    );
    expect(fileTabs(find(driver, session.id))).toHaveLength(1);
  });

  it('shows another file in the tab, keeping its tree', () => {
    const driver = new MockDriver();
    const { session, groupId } = singlePane(driver);
    const tab = driver.openFileIn(session.id, groupId, { kind: 'folder', root: '/repo' })!;
    driver.showFile(session.id, tab.id, '/repo/src/a.ts', 4);

    expect(find(driver, session.id).tabs[tab.id]).toMatchObject({
      root: '/repo',
      path: '/repo/src/a.ts',
      title: 'a.ts',
      line: 4,
    });
  });
});

describe('a request from a program', () => {
  it('lands beside the pane its tab is in, as a link or a file', () => {
    const driver = new MockDriver();
    const { session, groupId } = singlePane(driver);
    const tabId = session.groups[groupId].tabIds[0];

    driver.receiveRequest(tabId, { verb: 'open', url: 'http://localhost:5173/' });
    driver.receiveRequest(tabId, { verb: 'open', target: { kind: 'file', path: '/repo/PLAN.md' } });

    const after = find(driver, session.id);
    const right = rightNeighbor(after.layout, groupId)!;
    expect(after.groups[right].tabIds.map((id) => after.tabs[id].title)).toEqual([
      'localhost:5173',
      'PLAN.md',
    ]);
  });

  it('is ignored for a tab that is not there', () => {
    const driver = new MockDriver();
    const before = driver.list();
    driver.receiveRequest('t-gone', { verb: 'open', url: 'http://localhost:5173/' });
    expect(driver.list()).toEqual(before);
  });
});

describe('what a file tab keeps', () => {
  it('saves the file and the folder, not the line it was asked to land on', () => {
    const driver = new MockDriver();
    const { session, groupId } = singlePane(driver);
    const tab = driver.openFileIn(session.id, groupId, { kind: 'file', path: '/repo/a.ts', line: 9 })!;
    driver.patchTab(session.id, tab.id, { root: '/repo' });

    const saved = driver.snapshot().find((s) => s.id === session.id)!.tabs[tab.id];
    expect(saved).toMatchObject({ kind: 'file', path: '/repo/a.ts', root: '/repo' });
    expect('line' in saved).toBe(false);
  });

  it('names the tab after the last segment', () => {
    expect(titleFromPath('/repo/src/a.ts')).toBe('a.ts');
    expect(titleFromPath('/repo/docs/')).toBe('docs');
    expect(titleFromPath('~')).toBe('~');
  });
});
