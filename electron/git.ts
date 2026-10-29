import { spawn } from 'node:child_process';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { MAX_TEXT_BYTES, type FileContents } from './files';

/**
 * The working tree against HEAD, for the changes tab.
 *
 * Read-only, and careful to stay out of the way: an agent may be committing
 * in the same repository at the same moment, so every call runs with
 * GIT_OPTIONAL_LOCKS=0 and never takes the index lock to refresh it.
 *
 * These shapes are the renderer's GitDriver types, kept in step by hand.
 */

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';

export interface GitChange {
  path: string;
  oldPath?: string;
  kind: ChangeKind;
  added: number;
  removed: number;
  binary: boolean;
}

export interface GitStatus {
  root: string;
  branch: string | null;
  changes: GitChange[];
  truncated: boolean;
}

/** More than this and the list is cut: a review of thousands of files is not one. */
export const MAX_CHANGES = 1000;
/** Untracked files are read to count their lines; past this size they are not. */
const COUNT_LINES_BYTES = 1024 * 1024;
/** What `git hash-object -t tree /dev/null` prints: HEAD, for a repository with no commits. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const BINARY_PROBE_BYTES = 8000;

export interface GitResult {
  code: number;
  stdout: Buffer;
  /** Stopped reading at the limit. */
  truncated: boolean;
}

export type RunGit = (args: string[], cwd: string, limit?: number) => Promise<GitResult>;

/**
 * Run git and collect what it prints, up to `limit` bytes. Never throws: a
 * missing git, a missing directory and a failing command all come back as a
 * non-zero code, and the caller decides what that means.
 */
export function gitRunner(env: NodeJS.ProcessEnv): RunGit {
  return (args, cwd, limit = 64 * 1024 * 1024) =>
    new Promise((resolve) => {
      let child;
      try {
        child = spawn('git', args, {
          cwd,
          env: { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch {
        resolve({ code: -1, stdout: Buffer.alloc(0), truncated: false });
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      child.stdout.on('data', (chunk: Buffer) => {
        if (truncated) return;
        chunks.push(chunk);
        size += chunk.length;
        if (size > limit) {
          truncated = true;
          child.kill();
        }
      });
      const finish = (code: number) => {
        const stdout = Buffer.concat(chunks);
        resolve({ code: truncated ? 0 : code, stdout: truncated ? stdout.subarray(0, limit) : stdout, truncated });
      };
      child.on('error', () => finish(-1));
      child.on('close', (code) => finish(code ?? -1));
    });
}

/** NUL-separated output, without the empty field after the last NUL. */
function fields(out: Buffer): string[] {
  const parts = out.toString('utf8').split('\0');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}

interface NameStatus {
  kind: ChangeKind;
  path: string;
  oldPath?: string;
}

/** `git diff --name-status -z`: a status field, then one path, or two for a rename or copy. */
export function parseNameStatus(out: Buffer): NameStatus[] {
  const parts = fields(out);
  const entries: NameStatus[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++];
    const letter = status[0];
    if (letter === 'R' || letter === 'C') {
      const oldPath = parts[i++];
      const newPath = parts[i++];
      entries.push(
        letter === 'R' ? { kind: 'renamed', path: newPath, oldPath } : { kind: 'added', path: newPath },
      );
      continue;
    }
    const p = parts[i++];
    entries.push({ kind: letter === 'A' ? 'added' : letter === 'D' ? 'deleted' : 'modified', path: p });
  }
  return entries;
}

/**
 * `git diff --numstat -z`: `added<TAB>removed<TAB>path`, or for a rename
 * `added<TAB>removed<TAB>` then the old and new paths as fields of their own.
 * A binary file counts as `-` and `-`. Keyed by the new path.
 */
export function parseNumstat(out: Buffer): Map<string, { added: number; removed: number; binary: boolean }> {
  const parts = fields(out);
  const counts = new Map<string, { added: number; removed: number; binary: boolean }>();
  for (let i = 0; i < parts.length; ) {
    const [added, removed, p] = parts[i++].split('\t');
    let key = p;
    if (!p) {
      i++; // the old path
      key = parts[i++];
    }
    const binary = added === '-';
    counts.set(key, { added: binary ? 0 : Number(added), removed: binary ? 0 : Number(removed), binary });
  }
  return counts;
}

/** Lines in a file git does not know yet, counted as a diff would count them. */
async function countUntracked(file: string): Promise<{ added: number; binary: boolean }> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return { added: 0, binary: false };
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(info.size, COUNT_LINES_BYTES));
    const { bytesRead } = buffer.length ? await handle.read(buffer, 0, buffer.length, 0) : { bytesRead: 0 };
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) return { added: 0, binary: true };
    let lines = 0;
    for (const byte of bytes) if (byte === 10) lines++;
    // A last line with no newline is still a line.
    if (bytesRead > 0 && bytes[bytesRead - 1] !== 10) lines++;
    return { added: lines, binary: false };
  } finally {
    await handle.close();
  }
}

/** git's paths are relative to the top level and always use `/`. */
function absolute(root: string, relative: string): string {
  return path.join(root, ...relative.split('/'));
}

export async function gitStatus(dir: string, run: RunGit): Promise<GitStatus | null> {
  const top = await run(['rev-parse', '--show-toplevel'], dir);
  if (top.code !== 0) return null;
  const root = top.stdout.toString('utf8').trim();
  if (!root) return null;

  const [branch, head] = await Promise.all([
    run(['symbolic-ref', '--quiet', '--short', 'HEAD'], root),
    run(['rev-parse', '--verify', '--quiet', 'HEAD'], root),
  ]);
  const base = head.code === 0 ? 'HEAD' : EMPTY_TREE;

  const diffArgs = ['-c', 'core.quotepath=off', 'diff', '--no-color', '--no-ext-diff', '-M', '-z', base];
  const [names, numbers, others] = await Promise.all([
    run([...diffArgs, '--name-status'], root),
    run([...diffArgs, '--numstat'], root),
    run(['ls-files', '--others', '--exclude-standard', '-z'], root),
  ]);
  if (names.code !== 0) return null;

  const counts = parseNumstat(numbers.stdout);
  const tracked = parseNameStatus(names.stdout);
  const untracked = fields(others.stdout);

  let truncated = tracked.length + untracked.length > MAX_CHANGES;
  const changes: GitChange[] = tracked.slice(0, MAX_CHANGES).map((entry) => {
    const count = counts.get(entry.path) ?? { added: 0, removed: 0, binary: false };
    return {
      path: absolute(root, entry.path),
      ...(entry.oldPath ? { oldPath: absolute(root, entry.oldPath) } : {}),
      kind: entry.kind,
      ...count,
    };
  });
  for (const relative of untracked.slice(0, Math.max(0, MAX_CHANGES - changes.length))) {
    const p = absolute(root, relative);
    const count = await countUntracked(p).catch(() => ({ added: 0, binary: false }));
    changes.push({ path: p, kind: 'untracked', added: count.added, removed: 0, binary: count.binary });
  }
  if (others.truncated) truncated = true;

  changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    root,
    branch: branch.code === 0 ? branch.stdout.toString('utf8').trim() || null : null,
    changes,
    truncated,
  };
}

/** The file as HEAD has it, read with files.read's rules; null when HEAD has none. */
export async function gitOriginal(root: string, file: string, run: RunGit): Promise<FileContents | null> {
  const relative = path.relative(root, file).split(path.sep).join('/');
  if (!relative || relative.startsWith('..')) return null;
  const spec = `HEAD:${relative}`;
  const size = await run(['cat-file', '-s', spec], root);
  if (size.code !== 0) return null;
  const total = Number(size.stdout.toString('utf8').trim()) || 0;
  const shown = await run(['cat-file', 'blob', spec], root, MAX_TEXT_BYTES);
  if (shown.code !== 0) return null;
  const bytes = shown.stdout;
  if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) return { kind: 'binary', size: total };
  return { kind: 'text', text: bytes.toString('utf8'), size: total, truncated: total > bytes.length };
}
