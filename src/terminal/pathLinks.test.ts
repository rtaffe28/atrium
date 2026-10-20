import type { ILink, Terminal } from '@xterm/xterm';
import { describe, expect, it, vi } from 'vitest';
import type { FileStat } from '../host/types';
import { fileUrlPath, findPathCandidates, pathLinkProvider } from './pathLinks';

const texts = (line: string) => findPathCandidates(line).map((c) => c.text);

describe('findPathCandidates', () => {
  it('finds paths however they are rooted', () => {
    expect(
      texts('Edit src/components/Sidebar.tsx and ./README.md, ../x/y, ~/notes.txt, /etc/hosts'),
    ).toEqual(['src/components/Sidebar.tsx', './README.md', '../x/y', '~/notes.txt', '/etc/hosts']);
  });

  it('finds a bare file name, and takes a :line suffix with it', () => {
    expect(texts('Edit README.md')).toEqual(['README.md']);
    const [hit] = findPathCandidates('at src/foo.ts:12:3 in');
    expect(hit).toEqual({ text: 'src/foo.ts', start: 3, end: 18, line: 12 });
  });

  it('leaves URLs to the web-links addon', () => {
    expect(texts('Local: http://localhost:5173/app/index.html now')).toEqual([]);
    expect(texts('see https://example.com/docs/README.md.')).toEqual([]);
  });

  it('is not fooled by version numbers, prose or a lone slash', () => {
    expect(texts('vite v8.3.0 ready in 143 ms')).toEqual([]);
    expect(texts('47 passed, 0 failed. Done.')).toEqual([]);
    expect(texts('a / b and ... more')).toEqual([]);
  });

  it('drops the punctuation that follows a path in prose', () => {
    expect(texts('(see src/foo.ts).')).toEqual(['src/foo.ts']);
    expect(texts('"src/a.ts", then src/b.ts;')).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('fileUrlPath', () => {
  it('takes the path from a file: URL and nothing else', () => {
    expect(fileUrlPath('file:///tmp/a%20b.txt')).toBe('/tmp/a b.txt');
    expect(fileUrlPath('file://localhost/tmp/a.txt')).toBe('/tmp/a.txt');
    expect(fileUrlPath('file://nas/tmp/a.txt')).toBeNull();
    expect(fileUrlPath('https://example.com/a.txt')).toBeNull();
    expect(fileUrlPath('not a url')).toBeNull();
  });
});

describe('pathLinkProvider', () => {
  const termWith = (line: string) =>
    ({
      buffer: { active: { getLine: () => ({ translateToString: () => line }) } },
    }) as unknown as Terminal;

  const existing: Record<string, FileStat> = {
    '~/repo/src/a.ts': { kind: 'file', size: 1, mtime: 0 },
    '~/repo/src': { kind: 'directory', size: 0, mtime: 0 },
  };

  const provide = (term: Terminal, activate = vi.fn()) =>
    new Promise<ILink[] | undefined>((resolve) =>
      pathLinkProvider(term, {
        cwd: () => '~/repo',
        stat: async (path) => existing[path] ?? null,
        activate,
      }).provideLinks(1, resolve),
    );

  it('links what exists, resolved against the shell’s directory, and nothing else', async () => {
    const activate = vi.fn();
    const links = await provide(termWith('Edit src/a.ts and src/missing.ts'), activate);
    expect(links?.map((link) => link.text)).toEqual(['src/a.ts']);
    expect(links?.[0].range).toEqual({ start: { x: 6, y: 1 }, end: { x: 13, y: 1 } });

    const click = new MouseEvent('click', { metaKey: true });
    links?.[0].activate(click, 'src/a.ts');
    expect(activate).toHaveBeenCalledWith(click, '~/repo/src/a.ts', undefined, false);
  });

  it('says when a link is a folder, and carries the line asked for', async () => {
    const activate = vi.fn();
    const links = await provide(termWith('in src/ and src/a.ts:7'), activate);
    expect(links?.map((link) => link.text)).toEqual(['src/', 'src/a.ts:7']);
    links?.[0].activate(new MouseEvent('click'), 'src/');
    expect(activate).toHaveBeenLastCalledWith(expect.anything(), '~/repo/src', undefined, true);
    links?.[1].activate(new MouseEvent('click'), 'src/a.ts:7');
    expect(activate).toHaveBeenLastCalledWith(expect.anything(), '~/repo/src/a.ts', 7, false);
  });

  it('offers nothing for a line with no paths', async () => {
    expect(await provide(termWith('47 passed'))).toBeUndefined();
    expect(await provide(termWith('Edit src/missing.ts'))).toBeUndefined();
  });
});
