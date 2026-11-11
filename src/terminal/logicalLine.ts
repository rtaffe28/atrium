import type { IBuffer } from '@xterm/xterm';

/**
 * The text a link might span, which is not always one row.
 *
 * A terminal wraps a long line by itself and marks the rows it continued,
 * and those are easy. The harder ones are wrapped by the program: Claude
 * Code lays its output out to the pane's width and prints each row with a
 * newline of its own, indenting the rest under the first —
 *
 *   ⏺ https://github.com/rtaffe28/atrium/pull/16/files#diff-0123
 *     456789abcdef
 *
 * — so the terminal sees two lines, and a link read from one row stops at
 * the edge. A row that runs to the right edge and is followed by an
 * indented one is read as continuing into it, the indent dropped. That is
 * a guess, and it can join a word that only happened to end at the edge to
 * the next row's first word; that costs a link one word too long, where not
 * guessing costs every wrapped link.
 */

/** A cell, 1-based, as xterm's link ranges count. */
export interface CellPosition {
  x: number;
  y: number;
}

export interface LogicalLine {
  text: string;
  /** Where each UTF-16 unit of `text` is on screen. */
  at: CellPosition[];
}

export interface Row {
  /** Each cell's characters, '' for an empty one; the second half of a wide character is absent. */
  cells: { chars: string; x: number }[];
  /** The terminal continued the row above into this one. */
  wrapped: boolean;
}

/** Rows by 0-based index, so the joining can be tested without a terminal. */
export interface RowSource {
  cols: number;
  length: number;
  row(y: number): Row | undefined;
}

/** A row that ends this close to the right edge was cut there. */
const EDGE_SLACK = 2;
/** A continuation is indented by a margin, not a paragraph's worth. */
const MAX_INDENT = 8;
/** How far a link is followed across rows, either way. */
const MAX_ROWS = 16;

function lastFilled(row: Row): number {
  for (let i = row.cells.length - 1; i >= 0; i--) {
    if (row.cells[i].chars.trim()) return row.cells[i].x;
  }
  return -1;
}

function indentOf(row: Row): number {
  const first = row.cells.findIndex((cell) => cell.chars.trim());
  return first < 0 ? -1 : row.cells[first].x;
}

/** How `below` continues `above`: as the terminal wrapped it, as a program did, or not at all. */
function continuation(source: RowSource, above: Row, below: Row): 'wrapped' | 'broken' | null {
  if (below.wrapped) return 'wrapped';
  if (lastFilled(above) < source.cols - EDGE_SLACK) return null;
  const indent = indentOf(below);
  return indent >= 0 && indent <= MAX_INDENT ? 'broken' : null;
}

/** The logical line holding row `y` (0-based). */
export function logicalLineAt(source: RowSource, y: number): LogicalLine {
  let first = y;
  while (first > 0 && y - first < MAX_ROWS) {
    const above = source.row(first - 1);
    const here = source.row(first);
    if (!above || !here || !continuation(source, above, here)) break;
    first--;
  }

  const text: string[] = [];
  const at: CellPosition[] = [];
  let previous: Row | undefined;
  for (let r = first; r < source.length && r - y <= MAX_ROWS; r++) {
    const row = source.row(r);
    if (!row) break;
    let how: 'wrapped' | 'broken' | null = 'wrapped';
    if (previous) {
      how = continuation(source, previous, row);
      if (!how) break;
    }
    // A broken row's trailing blanks and its successor's indent are layout,
    // not part of anything printed across them.
    let cells = row.cells;
    if (how === 'broken' && previous) cells = cells.slice(cells.findIndex((cell) => cell.chars.trim()));
    const end = r + 1 < source.length && continuationAhead(source, row, r) === 'broken' ? lastFilledIndex(cells) + 1 : cells.length;
    for (const cell of cells.slice(0, end)) {
      const chars = cell.chars || ' ';
      for (const unit of chars) {
        for (let k = 0; k < unit.length; k++) {
          text.push(unit[k]);
          at.push({ x: cell.x + 1, y: r + 1 });
        }
      }
    }
    previous = row;
  }
  return { text: text.join(''), at };
}

function continuationAhead(source: RowSource, row: Row, r: number): 'wrapped' | 'broken' | null {
  const below = source.row(r + 1);
  return below ? continuation(source, row, below) : null;
}

function lastFilledIndex(cells: Row['cells']): number {
  for (let i = cells.length - 1; i >= 0; i--) if (cells[i].chars.trim()) return i;
  return -1;
}

/** xterm's buffer as rows. */
export function bufferRows(buffer: IBuffer, cols: number): RowSource {
  return {
    cols,
    length: buffer.length,
    row(y) {
      const line = buffer.getLine(y);
      if (!line) return undefined;
      const cells: Row['cells'] = [];
      for (let x = 0; x < cols; x++) {
        const cell = line.getCell(x);
        if (!cell) break;
        if (cell.getWidth() === 0) continue; // the right half of a wide character
        cells.push({ chars: cell.getChars(), x });
      }
      return { cells, wrapped: line.isWrapped };
    },
  };
}

/** The part of `line` from `start` to `end` (exclusive) as an xterm link range. */
export function rangeOf(line: LogicalLine, start: number, end: number) {
  return { start: line.at[start], end: line.at[end - 1] };
}

/** Whether a stretch of `line` has a cell on row `y` (1-based). */
export function touchesRow(line: LogicalLine, start: number, end: number, y: number): boolean {
  return line.at[start].y <= y && line.at[end - 1].y >= y;
}
