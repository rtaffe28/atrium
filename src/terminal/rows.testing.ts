import type { Row, RowSource } from './logicalLine';

/**
 * A screen for tests: each string is a row, padded to `cols`. A row that
 * starts with `\u0000` is one the terminal wrapped onto from the row above.
 */
export function screen(cols: number, lines: string[]): RowSource {
  const rows: Row[] = lines.map((raw) => {
    const wrapped = raw.startsWith('\u0000');
    const text = (wrapped ? raw.slice(1) : raw).padEnd(cols).slice(0, cols);
    return { wrapped, cells: [...text].map((chars, x) => ({ chars: chars === ' ' ? '' : chars, x })) };
  });
  return { cols, length: rows.length, row: (y) => rows[y] };
}
