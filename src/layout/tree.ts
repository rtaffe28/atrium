import type { LayoutNode } from '../session/types';

/** Walk to a node by child-index path. */
export function nodeAt(root: LayoutNode, path: number[]): LayoutNode | null {
  let node: LayoutNode = root;
  for (const index of path) {
    if (node.type !== 'split') return null;
    node = node.children[index];
  }
  return node;
}

/** Structural map over the tree, rebuilding only the spine that changed. */
function rewrite(
  node: LayoutNode,
  fn: (leaf: Extract<LayoutNode, { type: 'leaf' }>) => LayoutNode,
): LayoutNode {
  if (node.type === 'leaf') return fn(node);
  return {
    ...node,
    children: [rewrite(node.children[0], fn), rewrite(node.children[1], fn)],
  };
}

/**
 * Split the leaf holding `groupId`, placing `newGroupId` on the given edge.
 *
 * Left/top means the new pane comes first; the caller's mental model is
 * "the dragged tab lands where I dropped it", so order matters.
 */
export function splitLeaf(
  root: LayoutNode,
  groupId: string,
  newGroupId: string,
  edge: 'left' | 'right' | 'top' | 'bottom',
): LayoutNode {
  const direction = edge === 'left' || edge === 'right' ? 'row' : 'column';
  const newFirst = edge === 'left' || edge === 'top';

  return rewrite(root, (leaf) => {
    if (leaf.groupId !== groupId) return leaf;
    const fresh: LayoutNode = { type: 'leaf', groupId: newGroupId };
    return {
      type: 'split',
      direction,
      children: newFirst ? [fresh, leaf] : [leaf, fresh],
      sizes: [0.5, 0.5],
    };
  });
}

/** Remove a leaf and collapse its parent split into the surviving sibling. */
export function removeLeaf(root: LayoutNode, groupId: string): LayoutNode | null {
  if (root.type === 'leaf') return root.groupId === groupId ? null : root;

  const [a, b] = root.children;
  const left = removeLeaf(a, groupId);
  const right = removeLeaf(b, groupId);

  if (left === null) return right;
  if (right === null) return left;
  if (left === a && right === b) return root;
  return { ...root, children: [left, right] };
}

export function setSizesAt(
  root: LayoutNode,
  path: number[],
  sizes: [number, number],
): LayoutNode {
  if (path.length === 0) {
    if (root.type !== 'split') return root;
    return { ...root, sizes };
  }
  if (root.type !== 'split') return root;
  const [head, ...rest] = path;
  const children: [LayoutNode, LayoutNode] = [...root.children] as [
    LayoutNode,
    LayoutNode,
  ];
  children[head] = setSizesAt(children[head], rest, sizes);
  return { ...root, children };
}

export function leafGroupIds(root: LayoutNode): string[] {
  if (root.type === 'leaf') return [root.groupId];
  return [...leafGroupIds(root.children[0]), ...leafGroupIds(root.children[1])];
}
