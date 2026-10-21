import { watch as watchPath, type FSWatcher } from 'node:fs';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { WebContents } from 'electron';

/**
 * Files, read and watched for the renderer. Never written: the viewer is not
 * an editor, and the terminal beside it already contains one.
 *
 * These shapes are the renderer's FileDriver types, kept in step by hand
 * since the main process does not import from src/.
 */

export interface FileStat {
  kind: 'file' | 'directory' | 'other';
  size: number;
  mtime: number;
}

export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
}

export type FileContents =
  | { kind: 'text'; text: string; size: number; truncated: boolean }
  | { kind: 'binary'; size: number }
  | { kind: 'dataUrl'; dataUrl: string; size: number };

export type FileEvent = { type: 'changed' } | { type: 'deleted' };

/** Big enough for any source file; past this the renderer is told it has the start. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
/** An image larger than this is not going to be shown inline. */
const MAX_DATA_URL_BYTES = 20 * 1024 * 1024;
/** A NUL in the first block is the usual tell for something that is not text. */
const BINARY_PROBE_BYTES = 8000;
/** How long a burst of events for one path is allowed to settle. */
const SETTLE_MS = 50;

const HIDDEN_ALWAYS = new Set(['.DS_Store', '.git', 'node_modules']);

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

/** A path as the shell wrote it, made absolute: `~` is the home directory. */
export function expandHome(p: string, home = homedir()): string {
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return p;
}

export async function statPath(p: string): Promise<FileStat | null> {
  try {
    const info = await stat(p);
    return {
      kind: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other',
      size: info.size,
      mtime: info.mtimeMs,
    };
  } catch {
    // Not there, or not ours to read: either way, nothing to show.
    return null;
  }
}

/** Directories first, then files, both alphabetical — as an explorer reads. */
export async function listDirectory(dir: string): Promise<FileEntry[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => !HIDDEN_ALWAYS.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: path.join(dir, entry.name),
      directory: entry.isDirectory(),
    }))
    .sort((a, b) =>
      a.directory === b.directory ? a.name.localeCompare(b.name) : a.directory ? -1 : 1,
    );
}

export async function readContents(
  p: string,
  as: 'text' | 'dataUrl' = 'text',
  limit = MAX_TEXT_BYTES,
): Promise<FileContents> {
  const info = await stat(p);
  if (!info.isFile()) throw new Error(`Not a file: ${p}`);

  if (as === 'dataUrl') {
    if (info.size > MAX_DATA_URL_BYTES) throw new Error(`Too large to show: ${p}`);
    const bytes = await readFile(p);
    const mime = MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream';
    return { kind: 'dataUrl', dataUrl: `data:${mime};base64,${bytes.toString('base64')}`, size: info.size };
  }

  // Only the first `limit` bytes are read, so a log an agent has been
  // appending to for an hour does not go through IPC whole.
  const handle = await open(p, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(info.size, limit));
    const { bytesRead } = buffer.length > 0 ? await handle.read(buffer, 0, buffer.length, 0) : { bytesRead: 0 };
    if (buffer.subarray(0, Math.min(bytesRead, BINARY_PROBE_BYTES)).includes(0)) {
      return { kind: 'binary', size: info.size };
    }
    return {
      kind: 'text',
      text: buffer.subarray(0, bytesRead).toString('utf8'),
      size: info.size,
      truncated: info.size > bytesRead,
    };
  } finally {
    await handle.close();
  }
}

interface Subscription {
  target: string;
  /** The entry's name within the watched directory, or null for the directory itself. */
  name: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Watches, one per renderer subscription, over one fs.watch per directory.
 *
 * A file is watched through its directory, not its own inode: editors and
 * agents write-then-rename, which replaces the inode, and a watch on the old
 * one goes quietly stale on the first save. Watching the directory also means
 * a deleted file that is written back is seen coming back.
 *
 * Events for one subscription are let settle for a moment and then answered
 * with a stat, so a burst of writes is one `changed`, and a path that is gone
 * by then is `deleted`.
 */
export class FileWatchers {
  private dirs = new Map<string, { watcher: FSWatcher; subs: Map<number, Subscription> }>();

  constructor(private send: (id: number, event: FileEvent) => void) {}

  bind(contents: WebContents): void {
    this.send = (id, event) => {
      if (!contents.isDestroyed()) contents.send('files:changed', id, event);
    };
  }

  async watch(id: number, target: string): Promise<void> {
    this.unwatch(id);
    const info = await stat(target).catch(() => null);
    const directory = info?.isDirectory() ?? false;
    const dir = directory ? target : path.dirname(target);
    const name = directory ? null : path.basename(target);

    let entry = this.dirs.get(dir);
    if (!entry) {
      let watcher: FSWatcher;
      try {
        watcher = watchPath(dir, { persistent: false }, (_type, filename) =>
          this.changed(dir, filename === null ? null : String(filename)),
        );
      } catch {
        // The directory itself is missing. The renderer is told what it would
        // have found, and can watch again when it has reason to.
        this.send(id, { type: 'deleted' });
        return;
      }
      watcher.on('error', () => this.changed(dir, null));
      entry = { watcher, subs: new Map() };
      this.dirs.set(dir, entry);
    }
    entry.subs.set(id, { target, name, timer: null });
  }

  private changed(dir: string, filename: string | null): void {
    const entry = this.dirs.get(dir);
    if (!entry) return;
    for (const [id, sub] of entry.subs) {
      if (sub.name !== null && filename !== null && filename !== sub.name) continue;
      if (sub.timer) clearTimeout(sub.timer);
      sub.timer = setTimeout(() => {
        sub.timer = null;
        void stat(sub.target).then(
          () => this.send(id, { type: 'changed' }),
          () => this.send(id, { type: 'deleted' }),
        );
      }, SETTLE_MS);
    }
  }

  unwatch(id: number): void {
    for (const [dir, entry] of this.dirs) {
      const sub = entry.subs.get(id);
      if (!sub) continue;
      if (sub.timer) clearTimeout(sub.timer);
      entry.subs.delete(id);
      if (entry.subs.size === 0) {
        entry.watcher.close();
        this.dirs.delete(dir);
      }
    }
  }

  close(): void {
    for (const entry of this.dirs.values()) entry.watcher.close();
    this.dirs.clear();
  }
}
