import { describe, expect, it } from 'vitest';
import {
  basename,
  dirname,
  foldersBetween,
  isUnder,
  joinPath,
  normalizePath,
  relativeTo,
  resolveAgainst,
} from './paths';

describe('paths', () => {
  it('resolves dots and drops repeated slashes', () => {
    expect(normalizePath('/a//b/./c/../d/')).toBe('/a/b/d');
    expect(normalizePath('a/../../b')).toBe('../b');
    expect(normalizePath('/..')).toBe('/');
  });

  it('keeps ~ as a root for the host to expand', () => {
    expect(normalizePath('~/git/../notes')).toBe('~/notes');
    expect(normalizePath('~/..')).toBe('~');
    expect(dirname('~/x')).toBe('~');
    expect(dirname('~')).toBeNull();
    expect(dirname('/')).toBeNull();
    expect(basename('~')).toBe('~');
    expect(basename('/a/b.txt')).toBe('b.txt');
  });

  it('reads what a shell printed against where the shell was', () => {
    expect(resolveAgainst('/repo', 'src/a.ts')).toBe('/repo/src/a.ts');
    expect(resolveAgainst('/repo', './src/a.ts')).toBe('/repo/src/a.ts');
    expect(resolveAgainst('/repo/src', '../README.md')).toBe('/repo/README.md');
    expect(resolveAgainst('/repo', '/etc/hosts')).toBe('/etc/hosts');
    expect(resolveAgainst('/repo', '~/x')).toBe('~/x');
  });

  it('knows what is inside what', () => {
    expect(isUnder('/repo', '/repo/src/a.ts')).toBe(true);
    expect(isUnder('/repo', '/repository/a.ts')).toBe(false);
    expect(isUnder('/repo', '/repo')).toBe(true);
    expect(relativeTo('/repo', '/repo/src/a.ts')).toBe('src/a.ts');
    expect(relativeTo('/repo', '/elsewhere/a.ts')).toBe('/elsewhere/a.ts');
    expect(relativeTo('/repo', '/repo')).toBe('repo');
    expect(joinPath('/repo', 'src')).toBe('/repo/src');
  });

  it('lists the folders between a root and a file, nearest the root first', () => {
    expect(foldersBetween('/repo', '/repo/src/components/A.tsx')).toEqual([
      '/repo/src',
      '/repo/src/components',
    ]);
    expect(foldersBetween('/repo', '/repo/A.tsx')).toEqual([]);
    expect(foldersBetween('/repo', '/other/A.tsx')).toEqual([]);
  });
});
