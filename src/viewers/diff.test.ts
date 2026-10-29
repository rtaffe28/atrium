import { describe, expect, it } from 'vitest';
import { countChanges, diffLines, foldRows, MAX_EDIT_DISTANCE, splitLines, type DiffRow } from './diff';

/** The rows as `git diff` would print their bodies. */
function unified(rows: DiffRow[]): string[] {
  return rows.map((row) => `${row.kind === 'added' ? '+' : row.kind === 'removed' ? '-' : ' '}${row.text}`);
}

/** Both sides, read back from the rows. */
function sides(rows: DiffRow[]): { old: string[]; new: string[] } {
  return {
    old: rows.filter((r) => r.kind !== 'added').map((r) => r.text),
    new: rows.filter((r) => r.kind !== 'removed').map((r) => r.text),
  };
}

describe('splitLines', () => {
  it('does not count the newline that ends the file as a line', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
    expect(splitLines('')).toEqual([]);
    expect(splitLines('\n')).toEqual(['']);
  });
});

describe('diffLines', () => {
  it('shows a changed line as its old self above its new', () => {
    const rows = diffLines('a\nb\nc\n', 'a\nB\nc\n');
    expect(unified(rows)).toEqual([' a', '-b', '+B', ' c']);
  });

  it('numbers each line on the side it belongs to', () => {
    const rows = diffLines('a\nb\nc\n', 'a\nx\ny\nc\n');
    expect(rows.map((r) => [r.oldLine, r.newLine])).toEqual([
      [1, 1],
      [2, undefined],
      [undefined, 2],
      [undefined, 3],
      [3, 4],
    ]);
  });

  it('treats a new file as all added and a deleted one as all removed', () => {
    expect(unified(diffLines('', 'a\nb\n'))).toEqual(['+a', '+b']);
    expect(unified(diffLines('a\nb\n', ''))).toEqual(['-a', '-b']);
  });

  it('finds no changes in a file that has none', () => {
    const rows = diffLines('a\nb\n', 'a\nb\n');
    expect(countChanges(rows)).toEqual({ added: 0, removed: 0 });
  });

  it('finds the shortest edit, as git does', () => {
    // The classic example from Myers' paper: ABCABBA to CBABAC is five edits.
    const rows = diffLines('A\nB\nC\nA\nB\nB\nA\n', 'C\nB\nA\nB\nA\nC\n');
    const { added, removed } = countChanges(rows);
    expect(added + removed).toBe(5);
    expect(sides(rows)).toEqual({ old: ['A', 'B', 'C', 'A', 'B', 'B', 'A'], new: ['C', 'B', 'A', 'B', 'A', 'C'] });
  });

  it('reproduces both sides for arbitrary edits', () => {
    // A cheap property test: random files and random edits of them.
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let round = 0; round < 200; round++) {
      const old = Array.from({ length: rand(30) }, () => `line ${rand(8)}`);
      const next = [...old];
      for (let e = rand(6); e > 0; e--) {
        const at = rand(next.length + 1);
        if (rand(2) && next.length) next.splice(at, 1);
        else next.splice(at, 0, `new ${rand(8)}`);
      }
      const rows = diffLines(old.join('\n'), next.join('\n'));
      expect(sides(rows)).toEqual({ old, new: next });
      // Line numbers count up on each side without gaps.
      expect(rows.filter((r) => r.oldLine).map((r) => r.oldLine)).toEqual(old.map((_, i) => i + 1));
      expect(rows.filter((r) => r.newLine).map((r) => r.newLine)).toEqual(next.map((_, i) => i + 1));
    }
  });

  it('gives up searching on a file rewritten wholesale, and still shows both sides', () => {
    const count = MAX_EDIT_DISTANCE;
    const old = Array.from({ length: count }, (_, i) => `old ${i}`).join('\n');
    const next = Array.from({ length: count }, (_, i) => `new ${i}`).join('\n');
    const rows = diffLines(old, next);
    expect(countChanges(rows)).toEqual({ added: count, removed: count });
    expect(rows[0].kind).toBe('removed');
    expect(rows[rows.length - 1].kind).toBe('added');
  });
});

describe('foldRows', () => {
  const file = (n: number) => Array.from({ length: n }, (_, i) => `${i + 1}`);

  it('keeps context around a change and folds the rest', () => {
    const old = file(20);
    const next = [...old];
    next[9] = 'ten';
    const blocks = foldRows(diffLines(old.join('\n'), next.join('\n')), 3);
    expect(blocks.map((b) => (b.kind === 'gap' ? `gap ${b.count}` : `rows ${b.rows.length}`))).toEqual([
      'gap 6',
      'rows 8',
      'gap 7',
    ]);
  });

  it('shows a gap in full once it is expanded, joined to its neighbours', () => {
    const old = file(20);
    const next = [...old];
    next[9] = 'ten';
    const rows = diffLines(old.join('\n'), next.join('\n'));
    const blocks = foldRows(rows, 3, new Set([0]));
    expect(blocks.map((b) => (b.kind === 'gap' ? `gap ${b.count}` : `rows ${b.rows.length}`))).toEqual([
      'rows 14',
      'gap 7',
    ]);
  });

  it('does not fold a run too short to be worth a fold', () => {
    const old = file(20);
    const next = [...old];
    next[4] = 'five';
    next[12] = 'thirteen';
    // One unchanged line before the first change, and one between the two
    // changes' context: shown, not folded. Each changed line is two rows.
    const blocks = foldRows(diffLines(old.join('\n'), next.join('\n')), 3);
    expect(blocks.map((b) => (b.kind === 'gap' ? `gap ${b.count}` : `rows ${b.rows.length}`))).toEqual([
      'rows 18',
      'gap 4',
    ]);
  });

  it('shows nothing folded when asked for every line as context', () => {
    const rows = diffLines(file(50).join('\n'), [...file(50), 'more'].join('\n'));
    const blocks = foldRows(rows, Infinity);
    expect(blocks).toHaveLength(1);
  });
});
