import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Big enough for any source file, small enough not to stall the renderer. */
const MAX_BYTES = 512 * 1024;

const HIDDEN_ALWAYS = new Set(['.DS_Store', '.git', 'node_modules']);

/** Directories first, then files, both alphabetical — as an explorer reads. */
export async function listDirectory(path: string) {
  const entries = await readdir(path, { withFileTypes: true });
  return entries
    .filter((entry) => !HIDDEN_ALWAYS.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: join(path, entry.name),
      directory: entry.isDirectory(),
    }))
    .sort((a, b) =>
      a.directory === b.directory ? a.name.localeCompare(b.name) : a.directory ? -1 : 1,
    );
}

export async function readTextFile(path: string) {
  const info = await stat(path);
  if (!info.isFile()) return { text: '', truncated: false };

  const handle = await readFile(path);
  const slice = handle.subarray(0, MAX_BYTES);

  // A NUL byte in the first block is the usual tell for something that is not
  // text; showing it as text produces noise and a very slow render.
  if (slice.subarray(0, 8000).includes(0)) {
    return { text: '', truncated: false, binary: true } as const;
  }

  return { text: slice.toString('utf8'), truncated: handle.length > MAX_BYTES };
}
