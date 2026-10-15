import { describe, expect, it } from 'vitest';
import { rightNeighbor } from '../layout/tree';
import { isOpenLinkClick } from '../links';
import { MockDriver } from './mock';
import { titleFromUrl } from './store';
import type { LayoutNode, Session } from './types';

const find = (driver: MockDriver, id: string) => driver.list().find((s) => s.id === id)!;

function singlePane(driver: MockDriver): { session: Session; groupId: string } {
  const session = driver.list().find((s) => s.layout.type === 'leaf')!;
  return { session, groupId: Object.keys(session.groups)[0] };
}

describe('opening a link beside a pane', () => {
  it('splits to the right with a browser tab on the link', () => {
    const driver = new MockDriver();
    const { session, groupId } = singlePane(driver);

    driver.openLinkBeside(session.id, groupId, 'https://example.com/docs');

    const after = find(driver, session.id);
    expect(after.layout.type).toBe('split');
    const layout = after.layout as Extract<LayoutNode, { type: 'split' }>;
    expect(layout.direction).toBe('row');
    expect(layout.children[0]).toEqual({ type: 'leaf', groupId });

    const right = (layout.children[1] as { groupId: string }).groupId;
    const tab = after.tabs[after.groups[right].activeTabId!];
    expect(tab).toMatchObject({ kind: 'browser', url: 'https://example.com/docs', title: 'example.com' });
    // The pane the link was clicked in keeps what it had.
    expect(after.groups[groupId]).toEqual(session.groups[groupId]);
  });

  it('reuses the pane to the right instead of splitting again', () => {
    const driver = new MockDriver();
    const { session, groupId } = singlePane(driver);

    driver.openLinkBeside(session.id, groupId, 'https://a.test');
    driver.openLinkBeside(session.id, groupId, 'https://b.test');

    const after = find(driver, session.id);
    expect(Object.keys(after.groups)).toHaveLength(2);
    const right = rightNeighbor(after.layout, groupId)!;
    const urls = after.groups[right].tabIds.map((id) => after.tabs[id].url);
    expect(urls).toEqual(['https://a.test', 'https://b.test']);
    expect(after.tabs[after.groups[right].activeTabId!].url).toBe('https://b.test');
  });

  it('ignores a pane that no longer exists', () => {
    const driver = new MockDriver();
    const { session } = singlePane(driver);
    driver.openLinkBeside(session.id, 'g-gone', 'https://a.test');
    expect(find(driver, session.id)).toEqual(session);
  });
});

describe('rightNeighbor', () => {
  const leaf = (groupId: string): LayoutNode => ({ type: 'leaf', groupId });
  const row = (a: LayoutNode, b: LayoutNode): LayoutNode => ({
    type: 'split',
    direction: 'row',
    children: [a, b],
    sizes: [0.5, 0.5],
  });

  it('finds the other half of a row split', () => {
    expect(rightNeighbor(row(leaf('a'), leaf('b')), 'a')).toBe('b');
  });

  it('has none for the right-hand pane, a column split, or a split neighbour', () => {
    expect(rightNeighbor(row(leaf('a'), leaf('b')), 'b')).toBeNull();
    const column: LayoutNode = { ...(row(leaf('a'), leaf('b')) as Extract<LayoutNode, { type: 'split' }>), direction: 'column' };
    expect(rightNeighbor(column, 'a')).toBeNull();
    expect(rightNeighbor(row(leaf('a'), row(leaf('b'), leaf('c'))), 'a')).toBeNull();
  });

  it('looks inside nested splits', () => {
    expect(rightNeighbor(row(leaf('x'), row(leaf('b'), leaf('c'))), 'b')).toBe('c');
  });
});

describe('isOpenLinkClick', () => {
  it('wants Cmd on a Mac and Ctrl elsewhere', () => {
    expect(isOpenLinkClick({ metaKey: true, ctrlKey: false }, 'mac')).toBe(true);
    expect(isOpenLinkClick({ metaKey: false, ctrlKey: true }, 'mac')).toBe(false);
    expect(isOpenLinkClick({ metaKey: false, ctrlKey: true }, 'win')).toBe(true);
    expect(isOpenLinkClick({ metaKey: false, ctrlKey: true }, 'linux')).toBe(true);
    expect(isOpenLinkClick({ metaKey: true, ctrlKey: false }, 'linux')).toBe(false);
    expect(isOpenLinkClick({ metaKey: false, ctrlKey: false }, 'mac')).toBe(false);
  });
});

describe('titleFromUrl', () => {
  it('names a tab after its host, port included', () => {
    expect(titleFromUrl('https://example.com/docs')).toBe('example.com');
    expect(titleFromUrl('http://localhost:5173/app')).toBe('localhost:5173');
  });

  it('names a file tab after the file', () => {
    expect(titleFromUrl('file:///tmp/report.html')).toBe('report.html');
  });

  it('has a name for anything else', () => {
    expect(titleFromUrl('about:blank')).toBe('about');
    expect(titleFromUrl('')).toBe('New tab');
  });
});
