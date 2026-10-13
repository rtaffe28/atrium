import { describe, expect, it } from 'vitest';
import {
  APPEND,
  resolvePaneDrop,
  resolvePaneZone,
  resolveRailOrder,
  resolveTabBarDrop,
} from './zones';

// A realistic pane body: sidebar is 288 wide, title bar + tab bar are 72 tall.
const PANE = { left: 288, top: 72, width: 1152, height: 828 };
const at = (x: number, y: number) => resolvePaneDrop(x, y, PANE, 'g1');

const midY = PANE.top + PANE.height / 2;
const midX = PANE.left + PANE.width / 2;

describe('resolvePaneDrop', () => {
  it('splits side by side when dragged toward a side', () => {
    expect(at(PANE.left + 40, midY)).toEqual({ kind: 'split', groupId: 'g1', edge: 'left' });
    expect(at(PANE.left + PANE.width - 40, midY)).toEqual({
      kind: 'split',
      groupId: 'g1',
      edge: 'right',
    });
  });

  it('splits top and bottom when dragged toward those edges', () => {
    expect(at(midX, PANE.top + 30)).toEqual({ kind: 'split', groupId: 'g1', edge: 'top' });
    expect(at(midX, PANE.top + PANE.height - 30)).toEqual({
      kind: 'split',
      groupId: 'g1',
      edge: 'bottom',
    });
  });

  it('moves the tab into the pane when dropped in the middle', () => {
    expect(at(midX, midY)).toEqual({ kind: 'tabbar', groupId: 'g1', index: APPEND });
  });

  it('prefers a side-by-side split in the corners', () => {
    // Top-left corner, equally far into both bands: horizontal wins.
    const x = PANE.left + PANE.width * H_FRACTION;
    const y = PANE.top + PANE.height * V_FRACTION;
    expect(at(x, y)).toEqual({ kind: 'split', groupId: 'g1', edge: 'left' });
  });

  it('still allows a vertical split from a corner when clearly nearer the top', () => {
    const x = PANE.left + PANE.width * 0.28; // barely inside the horizontal band
    const y = PANE.top + PANE.height * 0.02; // deep inside the vertical band
    expect(at(x, y)).toEqual({ kind: 'split', groupId: 'g1', edge: 'top' });
  });

  it('is symmetric about the centre', () => {
    expect(at(PANE.left + 5, midY)).toMatchObject({ edge: 'left' });
    expect(at(PANE.left + PANE.width - 5, midY)).toMatchObject({ edge: 'right' });
  });
});

// Equal normalised depth into each band.
const H_FRACTION = 0.15;
const V_FRACTION = 0.11;

describe('resolveTabBarDrop', () => {
  const tabs = [
    { left: 100, width: 100 }, // midpoint 150
    { left: 200, width: 100 }, // midpoint 250
    { left: 300, width: 100 }, // midpoint 350
  ];

  it('inserts before the tab whose midpoint the pointer has not passed', () => {
    expect(resolveTabBarDrop(120, tabs, 'g1')).toEqual({ kind: 'tabbar', groupId: 'g1', index: 0 });
    expect(resolveTabBarDrop(210, tabs, 'g1')).toEqual({ kind: 'tabbar', groupId: 'g1', index: 1 });
    expect(resolveTabBarDrop(320, tabs, 'g1')).toEqual({ kind: 'tabbar', groupId: 'g1', index: 2 });
  });

  it('appends past the last midpoint', () => {
    expect(resolveTabBarDrop(900, tabs, 'g1')).toEqual({ kind: 'tabbar', groupId: 'g1', index: 3 });
  });
});

describe('resolvePaneZone', () => {
  // The whole pane, tab bar included.
  const PANE_FULL = { left: 288, top: 38, width: 1152, height: 862 };
  const BAR = 34;
  const inBar = (x: number) => resolvePaneZone(x, PANE_FULL.top + 10, PANE_FULL, BAR, 'g1');

  it('splits side by side when dragged to either end of the tab bar', () => {
    expect(inBar(PANE_FULL.left + 20)).toEqual({ kind: 'split', groupId: 'g1', edge: 'left' });
    expect(inBar(PANE_FULL.left + PANE_FULL.width - 20)).toEqual({
      kind: 'split',
      groupId: 'g1',
      edge: 'right',
    });
  });

  it('falls through to reordering in the middle of the tab bar', () => {
    expect(inBar(PANE_FULL.left + PANE_FULL.width / 2)).toBeNull();
  });

  it('never fires a vertical split from the tab bar row', () => {
    for (let f = 0; f <= 1; f += 0.05) {
      const action = inBar(PANE_FULL.left + PANE_FULL.width * f);
      if (action && action.kind === 'split') {
        expect(['left', 'right']).toContain(action.edge);
      }
    }
  });

  it('allows vertical splits below the tab bar', () => {
    const y = PANE_FULL.top + BAR + 20;
    expect(resolvePaneZone(PANE_FULL.left + PANE_FULL.width / 2, y, PANE_FULL, BAR, 'g1')).toEqual({
      kind: 'split',
      groupId: 'g1',
      edge: 'top',
    });
  });
});

describe('resolveRailOrder', () => {
  // Three rows of the other sessions, 60 tall from y=100: middles at 130, 190, 250.
  const rows = [0, 1, 2].map((i) => ({ top: 100 + i * 60, height: 60 }));

  it('puts the session before the first row whose middle the pointer has not passed', () => {
    expect(resolveRailOrder(50, rows)).toEqual({ kind: 'order', index: 0 });
    expect(resolveRailOrder(129, rows)).toEqual({ kind: 'order', index: 0 });
    expect(resolveRailOrder(130, rows)).toEqual({ kind: 'order', index: 1 });
    expect(resolveRailOrder(200, rows)).toEqual({ kind: 'order', index: 2 });
  });

  it('puts it last past the last middle', () => {
    expect(resolveRailOrder(250, rows)).toEqual({ kind: 'order', index: 3 });
    expect(resolveRailOrder(900, rows)).toEqual({ kind: 'order', index: 3 });
  });

  it('has one place when there are no other rows', () => {
    expect(resolveRailOrder(400, [])).toEqual({ kind: 'order', index: 0 });
  });
});
