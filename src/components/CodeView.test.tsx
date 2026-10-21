import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeView } from './CodeView';

const highlight = vi.hoisted(() => vi.fn());
vi.mock('../viewers/highlight', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../viewers/highlight')>()),
  highlight,
}));

describe('CodeView', () => {
  afterEach(() => {
    cleanup();
    highlight.mockReset();
  });

  it('shows the lines plain at once, numbered, and coloured when the highlighter answers', async () => {
    let answer!: (lines: unknown) => void;
    highlight.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<CodeView text={'const a = 1;\nlet b;\n'} language="typescript" />);

    expect(screen.getByText('const a = 1;')).toBeTruthy();
    expect(document.querySelectorAll('.code-line')).toHaveLength(2);
    expect([...document.querySelectorAll('.code-gutter')].map((el) => el.textContent)).toEqual(['1', '2']);
    expect(highlight).toHaveBeenCalledWith('const a = 1;\nlet b;\n', 'typescript');

    await act(async () => {
      answer([
        [{ text: 'const', color: '#bb9af7', style: 1 }, { text: ' a = 1;', color: '#c0caf5' }],
        [{ text: 'let b;', color: '#c0caf5' }],
      ]);
    });
    const keyword = screen.getByText('const');
    expect(keyword.getAttribute('style')).toContain('color: rgb(187, 154, 247)');
    expect(keyword.getAttribute('style')).toContain('font-style: italic');
  });

  it('stays plain for a file with no grammar, and when the highlighter cannot', () => {
    render(<CodeView text="hello" language={null} />);
    expect(highlight).not.toHaveBeenCalled();
    cleanup();

    highlight.mockRejectedValue(new Error('no worker'));
    render(<CodeView text="hello" language="typescript" />);
    expect(screen.getByText('hello')).toBeTruthy();
  });

  it('does not send a minified file to the highlighter', () => {
    render(<CodeView text={'x'.repeat(20_000)} language="javascript" />);
    expect(highlight).not.toHaveBeenCalled();
  });

  it('marks the line asked for', () => {
    highlight.mockRejectedValue(new Error('no worker'));
    render(<CodeView text={'a\nb\nc'} language={null} line={2} />);
    expect(document.querySelector('.code-line.is-marked')?.textContent).toBe('2b');
  });
});
