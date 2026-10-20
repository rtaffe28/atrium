import { describe, expect, it, vi } from 'vitest';
import { MockFiles, SAMPLE_ROOT } from './files';

const at = (path: string) => `${SAMPLE_ROOT}/${path}`;

describe('MockFiles', () => {
  it('lists folders first, then files, without the entries nobody opens a tree to see', async () => {
    const files = new MockFiles();
    const names = (await files.list(SAMPLE_ROOT)).map((e) => `${e.directory ? 'd' : 'f'} ${e.name}`);
    expect(names.filter((n) => n.startsWith('d'))).toEqual(['d build', 'd docs', 'd public', 'd src']);
    expect(names.filter((n) => n.startsWith('f')).sort()).toEqual(['f .gitignore', 'f README.md', 'f package.json']);
    expect(names.indexOf('d src')).toBeLessThan(names.indexOf('f README.md'));
    expect((await files.list(at('src'))).map((e) => e.name)).toEqual(['components', 'session', 'App.tsx', 'index.css']);
    await expect(files.list(at('nowhere'))).rejects.toThrow();
  });

  it('reads text, and calls a file with a NUL in it binary', async () => {
    const files = new MockFiles();
    const readme = await files.read(at('README.md'));
    expect(readme.kind).toBe('text');
    if (readme.kind === 'text') expect(readme.text).toContain('# atrium');
    expect(await files.read(at('build/icon.png'))).toMatchObject({ kind: 'binary' });
    await expect(files.read(at('missing.txt'))).rejects.toThrow();
  });

  it('knows a file from a folder from nothing', async () => {
    const files = new MockFiles();
    expect(await files.stat(at('README.md'))).toMatchObject({ kind: 'file' });
    expect(await files.stat(at('src/components'))).toMatchObject({ kind: 'directory' });
    expect(await files.stat(at('src/components/'))).toMatchObject({ kind: 'directory' });
    expect(await files.stat(at('nothing'))).toBeNull();
  });

  it('tells watchers what the agent did: a rewrite, a new file, a deletion', () => {
    const files = new MockFiles();
    const onFile = vi.fn();
    const onDir = vi.fn();
    files.watch(at('src/App.tsx'), onFile);
    files.watch(at('src'), onDir);

    files.append(at('src/App.tsx'), '\n// more\n');
    expect(onFile).toHaveBeenCalledWith({ type: 'changed' });
    expect(onDir).not.toHaveBeenCalled(); // the listing did not change

    files.write(at('src/New.tsx'), 'export {};\n');
    expect(onDir).toHaveBeenCalledWith({ type: 'changed' });

    files.remove(at('src/App.tsx'));
    expect(onFile).toHaveBeenLastCalledWith({ type: 'deleted' });
    expect(onDir).toHaveBeenCalledTimes(2);
  });

  it('stops telling a watcher that left', () => {
    const files = new MockFiles();
    const handler = vi.fn();
    const stop = files.watch(at('README.md'), handler);
    stop();
    files.append(at('README.md'), 'x');
    expect(handler).not.toHaveBeenCalled();
  });
});
