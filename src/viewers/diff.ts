/**
 * Line diffs, computed here rather than parsed from `git diff`.
 *
 * The host hands over the file as HEAD has it and as it is now; this lines
 * them up. Doing it in the renderer means one algorithm for every host — the
 * mock has no git to ask — and both sides whole, which the viewer needs
 * anyway to colour each line the way the file colours it.
 *
 * Myers' O(ND) algorithm, which is also git's default, so the hunks read the
 * way `git diff` would show them.
 */

export type RowKind = 'same' | 'added' | 'removed';

/** One line of a unified diff, with where it sits on each side, 1-based. */
export interface DiffRow {
  kind: RowKind;
  text: string;
  /** Absent for an added line. */
  oldLine?: number;
  /** Absent for a removed line. */
  newLine?: number;
}

/**
 * Past this many differences in the part that is not a shared prefix or
 * suffix, the middle is shown as all removed then all added. A file rewritten
 * wholesale reads no worse that way, and the search would cost seconds.
 */
export const MAX_EDIT_DISTANCE = 4000;

/** A trailing newline ends the last line; it is not an empty line after it. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Every line of both sides, in order: the old file's lines that stayed, went,
 * and the new file's lines that came, interleaved as a unified diff shows them
 * — within a change, what was removed comes before what was added.
 */
export function diffLines(oldText: string, newText: string): DiffRow[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);

  // Most edits touch a few lines of a long file; the shared ends cost nothing
  // to set aside and shrink the search to the part that changed.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const rows: DiffRow[] = [];
  for (let i = 0; i < start; i++) rows.push({ kind: 'same', text: a[i], oldLine: i + 1, newLine: i + 1 });

  const ops = middle(a.slice(start, endA), b.slice(start, endB));
  let i = start;
  let j = start;
  // Removals are held until the run of changes ends, then added lines follow
  // them, so a changed line reads as its old self above its new.
  let removed: DiffRow[] = [];
  let added: DiffRow[] = [];
  const flush = () => {
    rows.push(...removed, ...added);
    removed = [];
    added = [];
  };
  for (const op of ops) {
    if (op === 0) {
      flush();
      rows.push({ kind: 'same', text: a[i], oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (op < 0) {
      removed.push({ kind: 'removed', text: a[i], oldLine: i + 1 });
      i++;
    } else {
      added.push({ kind: 'added', text: b[j], newLine: j + 1 });
      j++;
    }
  }
  flush();

  for (let k = 0; k < a.length - endA; k++) {
    rows.push({ kind: 'same', text: a[endA + k], oldLine: endA + k + 1, newLine: endB + k + 1 });
  }
  return rows;
}

/**
 * The shortest edit script from `a` to `b`: 0 keeps a line, -1 removes one
 * from `a`, 1 adds one from `b`.
 *
 * Myers, keeping each step's frontier only as wide as that step reaches —
 * 2d+1 entries at step d — so the trace for backtracking costs D² rather
 * than D·(N+M).
 */
function middle(a: string[], b: string[]): number[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return new Array<number>(m).fill(1);
  if (m === 0) return new Array<number>(n).fill(-1);

  const limit = Math.min(n + m, MAX_EDIT_DISTANCE);
  // v[k] is the furthest x reached on diagonal k = x - y, offset by `limit`.
  const offset = limit + 1;
  const v = new Int32Array(2 * offset + 1);
  const trace: Int32Array[] = [];
  let found = -1;

  for (let d = 0; d <= limit; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1] // down: a line added
          : v[offset + k - 1] + 1; // right: a line removed
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    trace.push(v.slice(offset - d, offset + d + 1));
    if (found >= 0) break;
  }

  if (found < 0) {
    // Too different to be worth the search: the whole middle replaced.
    return [...new Array<number>(n).fill(-1), ...new Array<number>(m).fill(1)];
  }

  // Walk back from the end, one step of d at a time.
  const ops: number[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1];
    const at = (k: number) => prev[k + d - 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push(0);
      x--;
      y--;
    }
    if (down) {
      ops.push(1);
      y--;
    } else {
      ops.push(-1);
      x--;
    }
  }
  while (x > 0 && y > 0) {
    ops.push(0);
    x--;
    y--;
  }
  return ops.reverse();
}

/** How many lines came and went. */
export function countChanges(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.kind === 'added') added++;
    else if (row.kind === 'removed') removed++;
  }
  return { added, removed };
}

/** A run of rows to show, or a run of unchanged ones folded away. */
/** A fold is a line tall itself, so a run shorter than this is shown rather than folded. */
export const MIN_FOLD = 4;

export type DiffBlock =
  | { kind: 'rows'; start: number; rows: DiffRow[] }
  | { kind: 'gap'; start: number; count: number };

/**
 * The rows as a reader wants them: every change with `context` lines either
 * side, and what lies between folded into gaps. A gap whose start is in
 * `expanded` is shown in full. Gaps are keyed by the index of their first
 * row, which stays put while the file does.
 */
export function foldRows(rows: DiffRow[], context: number, expanded: ReadonlySet<number> = new Set()): DiffBlock[] {
  // A row is shown when a change is within `context` of it: the distance to
  // the nearest change behind, then ahead, in two passes.
  const shown = new Uint8Array(rows.length);
  let since = Infinity;
  for (let i = 0; i < rows.length; i++) {
    since = rows[i].kind === 'same' ? since + 1 : 0;
    if (since <= context) shown[i] = 1;
  }
  let until = Infinity;
  for (let i = rows.length - 1; i >= 0; i--) {
    until = rows[i].kind === 'same' ? until + 1 : 0;
    if (until <= context) shown[i] = 1;
  }

  const blocks: DiffBlock[] = [];
  let i = 0;
  while (i < rows.length) {
    const start = i;
    if (shown[i]) {
      while (i < rows.length && shown[i]) i++;
      blocks.push({ kind: 'rows', start, rows: rows.slice(start, i) });
      continue;
    }
    while (i < rows.length && !shown[i]) i++;
    if (expanded.has(start) || i - start < MIN_FOLD) blocks.push({ kind: 'rows', start, rows: rows.slice(start, i) });
    else blocks.push({ kind: 'gap', start, count: i - start });
  }

  // Neighbouring runs merge, so an expanded gap does not leave a seam.
  const merged: DiffBlock[] = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (block.kind === 'rows' && last?.kind === 'rows') last.rows = [...last.rows, ...block.rows];
    else merged.push(block);
  }
  return merged;
}
