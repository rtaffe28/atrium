import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitOriginal, gitRunner, gitStatus, parseNameStatus, parseNumstat } from './git';

const run = gitRunner(process.env);

let dir: string;
const git = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: dir,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
    stdio: 'ignore',
  });

beforeEach(() => {
  // The real path: git reports its top level resolved, and macOS's tmpdir is a symlink.
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'atrium-git-')));
  git('init', '-q', '-b', 'main');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('parsers', () => {
  it('reads renames as two paths and everything else as one', () => {
    const out = Buffer.from('M\0a.ts\0R100\0old.ts\0new.ts\0A\0b.ts\0D\0c.ts\0');
    expect(parseNameStatus(out)).toEqual([
      { kind: 'modified', path: 'a.ts' },
      { kind: 'renamed', path: 'new.ts', oldPath: 'old.ts' },
      { kind: 'added', path: 'b.ts' },
      { kind: 'deleted', path: 'c.ts' },
    ]);
  });

  it('keys counts by the new path, and marks binary files', () => {
    const out = Buffer.from('3\t1\ta.ts\0' + '0\t0\t\0old.ts\0new.ts\0' + '-\t-\timg.png\0');
    expect(Object.fromEntries(parseNumstat(out))).toEqual({
      'a.ts': { added: 3, removed: 1, binary: false },
      'new.ts': { added: 0, removed: 0, binary: false },
      'img.png': { added: 0, removed: 0, binary: true },
    });
  });
});

describe('gitStatus', () => {
  it('is null outside a repository', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'atrium-nogit-'));
    try {
      expect(await gitStatus(outside, run)).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('lists every change against HEAD, staged or not, with its lines', async () => {
    writeFileSync(join(dir, 'kept.txt'), 'one\ntwo\nthree\n');
    writeFileSync(join(dir, 'gone.txt'), 'bye\n');
    writeFileSync(join(dir, 'moved.txt'), 'a\nb\nc\nd\ne\nf\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');

    writeFileSync(join(dir, 'kept.txt'), 'one\n2\nthree\nfour\n');
    unlinkSync(join(dir, 'gone.txt'));
    git('mv', 'moved.txt', 'renamed.txt');
    writeFileSync(join(dir, 'staged.txt'), 'new\n');
    git('add', 'staged.txt');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'fresh.ts'), 'a\nb');

    const status = await gitStatus(join(dir, 'src'), run);
    expect(status?.root).toBe(dir);
    expect(status?.branch).toBe('main');
    expect(status?.truncated).toBe(false);
    expect(status?.changes).toEqual([
      { path: join(dir, 'gone.txt'), kind: 'deleted', added: 0, removed: 1, binary: false },
      { path: join(dir, 'kept.txt'), kind: 'modified', added: 2, removed: 1, binary: false },
      {
        path: join(dir, 'renamed.txt'),
        oldPath: join(dir, 'moved.txt'),
        kind: 'renamed',
        added: 0,
        removed: 0,
        binary: false,
      },
      { path: join(dir, 'src', 'fresh.ts'), kind: 'untracked', added: 2, removed: 0, binary: false },
      { path: join(dir, 'staged.txt'), kind: 'added', added: 1, removed: 0, binary: false },
    ]);
  });

  it('works in a repository with no commits yet', async () => {
    writeFileSync(join(dir, 'a.txt'), 'x\n');
    git('add', 'a.txt');
    writeFileSync(join(dir, 'b.txt'), 'y\n');
    const status = await gitStatus(dir, run);
    expect(status?.changes.map((c) => [c.kind, c.added])).toEqual([
      ['added', 1],
      ['untracked', 1],
    ]);
  });

  it('respects .gitignore', async () => {
    writeFileSync(join(dir, '.gitignore'), 'dist/\n');
    mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'dist', 'bundle.js'), 'x\n');
    const status = await gitStatus(dir, run);
    expect(status?.changes.map((c) => c.path)).toEqual([join(dir, '.gitignore')]);
  });
});

describe('gitOriginal', () => {
  it('reads a file as HEAD has it, and null for one HEAD lacks', async () => {
    writeFileSync(join(dir, 'a.txt'), 'before\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    writeFileSync(join(dir, 'a.txt'), 'after\n');

    expect(await gitOriginal(dir, join(dir, 'a.txt'), run)).toEqual({
      kind: 'text',
      text: 'before\n',
      size: 7,
      truncated: false,
    });
    expect(await gitOriginal(dir, join(dir, 'nope.txt'), run)).toBeNull();
    expect(await gitOriginal(dir, '/elsewhere/a.txt', run)).toBeNull();
  });

  it('says a binary file is binary', async () => {
    writeFileSync(join(dir, 'b.bin'), Buffer.from([1, 0, 2, 0]));
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    expect(await gitOriginal(dir, join(dir, 'b.bin'), run)).toEqual({ kind: 'binary', size: 4 });
  });
});
