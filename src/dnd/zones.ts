import type { DropAction } from '../session/types';

/** Sentinel meaning "append to the end of the tab bar". */
export const APPEND = Number.MAX_SAFE_INTEGER;

/**
 * How deep the split bands reach in from each edge, as a fraction of the pane.
 *
 * Horizontal is deliberately wider than vertical: side-by-side is the default
 * arrangement for comparing two things, so a rough drag toward a side should
 * land it. Stacking is the less common intent, so it asks for a more committed
 * move toward the top or bottom edge.
 */
export const H_BAND = 0.3;
export const V_BAND = 0.22;

/**
 * The split band inside the tab bar row, narrower than in the body.
 *
 * Dragging a tab sideways is the natural gesture for "put these side by side",
 * but the tab bar also has to stay usable for reordering. The outer sixth of
 * each side splits; the middle two thirds still reorder.
 */
export const TABBAR_H_BAND = 0.16;

/**
 * Where a tab dropped at (x, y) over a pane body should go.
 *
 * Outer bands split on that edge; the middle moves the tab into this pane's
 * tab bar. In a corner, each candidate is normalised against its own band so
 * "how far into the band am I" decides — and ties go to horizontal.
 */
export function resolvePaneDrop(
  x: number,
  y: number,
  rect: { left: number; top: number; width: number; height: number },
  groupId: string,
): DropAction {
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;

  const horizontal =
    fx <= 1 - fx ? { edge: 'left' as const, d: fx } : { edge: 'right' as const, d: 1 - fx };
  const vertical =
    fy <= 1 - fy ? { edge: 'top' as const, d: fy } : { edge: 'bottom' as const, d: 1 - fy };

  const hHit = horizontal.d < H_BAND;
  const vHit = vertical.d < V_BAND;

  if (hHit && vHit) {
    const edge = vertical.d / V_BAND < horizontal.d / H_BAND ? vertical.edge : horizontal.edge;
    return { kind: 'split', groupId, edge };
  }
  if (hHit) return { kind: 'split', groupId, edge: horizontal.edge };
  if (vHit) return { kind: 'split', groupId, edge: vertical.edge };
  return { kind: 'tabbar', groupId, index: APPEND };
}

/** Insertion index for a tab dropped at x over a bar with these tab rects. */
export function resolveTabBarDrop(
  x: number,
  tabRects: Array<{ left: number; width: number }>,
  groupId: string,
): DropAction {
  for (let i = 0; i < tabRects.length; i++) {
    if (x < tabRects[i].left + tabRects[i].width / 2) {
      return { kind: 'tabbar', groupId, index: i };
    }
  }
  return { kind: 'tabbar', groupId, index: tabRects.length };
}

/**
 * Where a tab dropped at (x, y) anywhere over a pane should go.
 *
 * This zone covers the whole pane — tab bar included — and outranks the tab
 * bar's own reorder zone, so a sideways drag along the bar splits instead of
 * merely shuffling tabs. Returning null in the bar's middle lets the drop fall
 * through to reordering.
 *
 * Vertical splits are deliberately unavailable from the bar: the bar *is* the
 * top edge of the pane, so a top band there would fire constantly.
 */
export function resolvePaneZone(
  x: number,
  y: number,
  pane: { left: number; top: number; width: number; height: number },
  tabBarHeight: number,
  groupId: string,
): DropAction | null {
  const fx = (x - pane.left) / pane.width;

  if (y < pane.top + tabBarHeight) {
    if (fx < TABBAR_H_BAND) return { kind: 'split', groupId, edge: 'left' };
    if (1 - fx < TABBAR_H_BAND) return { kind: 'split', groupId, edge: 'right' };
    return null; // the tab bar's reorder zone handles the middle
  }

  return resolvePaneDrop(
    x,
    y,
    {
      left: pane.left,
      top: pane.top + tabBarHeight,
      width: pane.width,
      height: pane.height - tabBarHeight,
    },
    groupId,
  );
}
