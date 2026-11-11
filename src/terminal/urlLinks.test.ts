import type { ILink } from '@xterm/xterm';
import { describe, expect, it, vi } from 'vitest';
import { screen } from './rows.testing';
import { findUrls, urlLinkProvider } from './urlLinks';

const provide = (cols: number, lines: string[], y: number, activate = vi.fn()) =>
  new Promise<ILink[] | undefined>((resolve) => urlLinkProvider(() => screen(cols, lines), activate).provideLinks(y, resolve));

describe('findUrls', () => {
  it('finds http(s) URLs and leaves the punctuation after them', () => {
    expect(findUrls('see https://example.com/a?b=1, and http://localhost:5173/.').map((u) => u.url)).toEqual([
      'https://example.com/a?b=1',
      'http://localhost:5173/',
    ]);
  });
});

describe('urlLinkProvider', () => {
  const claude = [
    '⏺ https://github.com/rtaffe28/atrium/pull/16/files#diff-0123',
    '  456789abcdef0123456789abcdef0123',
  ];
  const whole = 'https://github.com/rtaffe28/atrium/pull/16/files#diff-0123456789abcdef0123456789abcdef0123';

  it('opens the whole URL from either row of one Claude Code wrapped', async () => {
    for (const y of [1, 2]) {
      const activate = vi.fn();
      const links = await provide(60, claude, y, activate);
      expect(links?.map((link) => link.text)).toEqual([whole]);
      expect(links?.[0].range).toEqual({ start: { x: 3, y: 1 }, end: { x: 34, y: 2 } });
      const click = new MouseEvent('click', { metaKey: true });
      links?.[0].activate(click, whole);
      expect(activate).toHaveBeenCalledWith(click, whole);
    }
  });

  it('only offers the links on the row asked about', async () => {
    expect(await provide(40, ['https://a.test/x', 'nothing here'], 2)).toBeUndefined();
  });
});
