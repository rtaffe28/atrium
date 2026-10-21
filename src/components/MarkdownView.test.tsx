import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostProvider } from '../host/HostProvider';
import { MockHost } from '../host/mock';
import { SAMPLE_ROOT } from '../host/mock/files';
import { fenceLanguage } from '../viewers/kind';
import { MarkdownView } from './MarkdownView';

function show(text: string, path = `${SAMPLE_ROOT}/README.md`) {
  const onShow = vi.fn();
  const onOpenBeside = vi.fn();
  const onOpenLink = vi.fn();
  render(
    <HostProvider host={new MockHost()}>
      <MarkdownView path={path} text={text} onShow={onShow} onOpenBeside={onOpenBeside} onOpenLink={onOpenLink} />
    </HostProvider>,
  );
  return { onShow, onOpenBeside, onOpenLink };
}

describe('MarkdownView', () => {
  afterEach(cleanup);

  it('renders a README the way GitHub does', () => {
    show('# Atrium\n\n## Running it\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [ ] todo\n- [x] done\n\n~~gone~~ and https://example.com\n');
    expect(screen.getByRole('heading', { level: 1, name: 'Atrium' }).id).toBe('atrium');
    expect(screen.getByRole('heading', { level: 2, name: 'Running it' }).id).toBe('running-it');
    expect(screen.getByRole('table')).toBeTruthy();
    const boxes = document.querySelectorAll('li.task input[type=checkbox]');
    expect(boxes).toHaveLength(2);
    expect((boxes[1] as HTMLInputElement).checked).toBe(true);
    expect(document.querySelector('s')?.textContent).toBe('gone');
    expect(screen.getByRole('link', { name: 'https://example.com' })).toBeTruthy();
  });

  it('escapes raw HTML rather than rendering it', () => {
    show('hello <script>alert(1)</script> <b>there</b>');
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
    expect(document.querySelector('.markdown')?.textContent).toContain('<b>there</b>');
  });

  it('opens a link to a file in place, beside on a Ctrl-click, and the web beside', () => {
    const { onShow, onOpenBeside, onOpenLink } = show(
      '[plan](docs/plan/README.md) [up](../x.md) [web](https://example.com/a) [here](#top)',
    );
    fireEvent.click(screen.getByText('plan'));
    expect(onShow).toHaveBeenCalledWith(`${SAMPLE_ROOT}/docs/plan/README.md`);
    fireEvent.click(screen.getByText('up'), { ctrlKey: true });
    expect(onOpenBeside).toHaveBeenCalledWith({ kind: 'file', path: '~/git/x.md' });
    fireEvent.click(screen.getByText('web'));
    expect(onOpenLink).toHaveBeenCalledWith('https://example.com/a');
    fireEvent.click(screen.getByText('here'));
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('reads an image beside the file through the host', async () => {
    show('![icon](public/favicon.svg)');
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toMatch(/^data:/));
  });

  it('names the grammar a fence asks for', () => {
    expect(fenceLanguage('ts')).toBe('typescript');
    expect(fenceLanguage('sh')).toBe('shellscript');
    expect(fenceLanguage('typescript {1,2}')).toBe('typescript');
    expect(fenceLanguage('')).toBeNull();
  });
});
