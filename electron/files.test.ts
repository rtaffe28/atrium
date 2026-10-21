import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FileWatchers,
  expandHome,
  listDirectory,
  readContents,
  statPath,
  type FileEvent,
} from './files';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atrium-files-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('listDirectory', () => {
  it('puts folders first and drops what nobody opens a tree to see', async () => {
    for (const d of ['src', 'node_modules', '.git']) mkdirSync(join(dir, d));
    for (const f of ['b.txt', 'a.txt', '.DS_Store']) writeFileSync(join(dir, f), '');
    expect((await listDirectory(dir)).map((e) => e.name)).toEqual(['src', 'a.txt', 'b.txt']);
  });
});

describe('readContents', () => {
  it('reads text, and says when there was more of it', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello world');
    expect(await readContents(join(dir, 'a.txt'))).toEqual({
      kind: 'text',
      text: 'hello world',
      size: 11,
      truncated: false,
    });
    expect(await readContents(join(dir, 'a.txt'), 'text', 5)).toEqual({
      kind: 'text',
      text: 'hello',
      size: 11,
      truncated: true,
    });
  });

  it('reads an empty file', async () => {
    writeFileSync(join(dir, 'empty'), '');
    expect(await readContents(join(dir, 'empty'))).toEqual({ kind: 'text', text: '', size: 0, truncated: false });
  });

  it('calls a file with a NUL in its first block binary', async () => {
    writeFileSync(join(dir, 'a.bin'), Buffer.from([0x89, 0x50, 0, 0x47]));
    expect(await readContents(join(dir, 'a.bin'))).toEqual({ kind: 'binary', size: 4 });
  });

  it('reads an image as a data URL', async () => {
    writeFileSync(join(dir, 'a.png'), Buffer.from([1, 2, 3]));
    expect(await readContents(join(dir, 'a.png'), 'dataUrl')).toEqual({
      kind: 'dataUrl',
      dataUrl: 'data:image/png;base64,AQID',
      size: 3,
    });
  });

  it('refuses a directory', async () => {
    await expect(readContents(dir)).rejects.toThrow(/Not a file/);
  });
});

describe('statPath and expandHome', () => {
  it('tells a file from a folder from nothing', async () => {
    writeFileSync(join(dir, 'a.txt'), 'abc');
    expect(await statPath(join(dir, 'a.txt'))).toMatchObject({ kind: 'file', size: 3 });
    expect(await statPath(dir)).toMatchObject({ kind: 'directory' });
    expect(await statPath(join(dir, 'nothing'))).toBeNull();
  });

  it('expands ~ and leaves the rest alone', () => {
    expect(expandHome('~', '/home/me')).toBe('/home/me');
    expect(expandHome('~/x/y', '/home/me')).toBe('/home/me/x/y');
    expect(expandHome('/x/~/y', '/home/me')).toBe('/x/~/y');
    expect(expandHome('~other/x', '/home/me')).toBe('~other/x');
  });
});

describe('FileWatchers', () => {
  const WAIT = { timeout: 4000, interval: 25 };

  /**
   * The first fs.watch in a process starts libuv's FSEvents thread, and a
   * write in the few milliseconds before it is running is not reported. A
   * reader has just read the file anyway; a test writing straight away has
   * not, so it waits.
   */
  const settled = () => new Promise((resolve) => setTimeout(resolve, 250));

  it('hears a file rewritten, and then deleted, through its directory', async () => {
    const file = join(dir, 'a.txt');
    writeFileSync(file, 'one');
    const events: FileEvent[] = [];
    const watchers = new FileWatchers((_id, event) => events.push(event));
    await watchers.watch(1, file);
    try {
      await settled();
      writeFileSync(file, 'two');
      await vi.waitFor(() => expect(events).toContainEqual({ type: 'changed' }), WAIT);
      unlinkSync(file);
      await vi.waitFor(() => expect(events).toContainEqual({ type: 'deleted' }), WAIT);
    } finally {
      watchers.close();
    }
  });

  it('hears a new entry in a watched directory', async () => {
    const events: FileEvent[] = [];
    const watchers = new FileWatchers((_id, event) => events.push(event));
    await watchers.watch(2, dir);
    try {
      await settled();
      writeFileSync(join(dir, 'new.txt'), '');
      await vi.waitFor(() => expect(events).toContainEqual({ type: 'changed' }), WAIT);
    } finally {
      watchers.close();
    }
  });

  it('answers a watch on nothing with deleted, and is quiet after unwatch', async () => {
    const events: Array<[number, FileEvent]> = [];
    const watchers = new FileWatchers((id, event) => events.push([id, event]));
    await watchers.watch(3, join(dir, 'missing', 'a.txt'));
    expect(events).toEqual([[3, { type: 'deleted' }]]);

    await watchers.watch(4, dir);
    watchers.unwatch(4);
    writeFileSync(join(dir, 'late.txt'), '');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(events).toHaveLength(1);
    watchers.close();
  });
});
