import { describe, expect, it } from 'vitest';
import { logicalLineAt } from './logicalLine';
import { screen } from './rows.testing';

const textAt = (cols: number, lines: string[], y: number) => logicalLineAt(screen(cols, lines), y).text.trimEnd();

describe('logicalLineAt', () => {
  it('reads one row when nothing continues it', () => {
    expect(textAt(20, ['short line', 'another'], 0)).toBe('short line');
    expect(textAt(20, ['short line', 'another'], 1)).toBe('another');
  });

  it('joins rows the terminal wrapped, from any of them', () => {
    const lines = ['https://example.com/', '\u0000a/very/long/path/to/', '\u0000somewhere'];
    for (const y of [0, 1, 2]) expect(textAt(20, lines, y)).toBe('https://example.com/a/very/long/path/to/somewhere');
  });

  it('joins a row a program broke at the edge to its indented continuation, without the indent', () => {
    // Claude Code's own layout, as captured from it in a 60-column pty.
    const lines = [
      '⏺ https://github.com/rtaffe28/atrium/pull/16/files#diff-0123',
      '  456789abcdef0123456789abcdef0123',
      '',
      '✻ Worked for 3s',
    ];
    const joined = 'https://github.com/rtaffe28/atrium/pull/16/files#diff-0123456789abcdef0123456789abcdef0123';
    expect(textAt(60, lines, 0)).toBe(`⏺ ${joined}`);
    expect(textAt(60, lines, 1)).toBe(`⏺ ${joined}`);
    expect(textAt(60, lines, 3)).toBe('✻ Worked for 3s');
  });

  it('allows a cell of right padding before the edge, as a bordered box has', () => {
    const lines = ['❯ Reply: https://example.com/aaaa ', '  bbbb'];
    expect(textAt(34, lines, 0)).toBe('❯ Reply: https://example.com/aaaabbbb');
  });

  it('does not join a row that stops short of the edge, or an unindented paragraph', () => {
    expect(textAt(40, ['see https://example.com/a', '  and more'], 0)).toBe('see https://example.com/a');
    expect(textAt(20, ['xxxxxxxxxxxxxxxxxxxx', '            far indented'], 0)).toBe('xxxxxxxxxxxxxxxxxxxx');
    expect(textAt(20, ['xxxxxxxxxxxxxxxxxxxx', ''], 0)).toBe('xxxxxxxxxxxxxxxxxxxx');
  });

  it('puts each character on its own cell, wide ones included', () => {
    const line = logicalLineAt(screen(10, ['ab', '\u0000cd']), 1);
    expect(line.at.slice(0, 2)).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
    expect(line.at[10]).toEqual({ x: 1, y: 2 });
  });
});
