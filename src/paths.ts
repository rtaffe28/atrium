/**
 * Path arithmetic on strings, for the renderer.
 *
 * The renderer never touches a filesystem, so it needs no platform module;
 * what it does need is to take a path apart the way a shell wrote it. `~` is
 * kept as a root segment rather than expanded: the renderer does not know the
 * home directory, and every host does.
 */

export interface SplitPath {
  /** How the path starts: absolute, under the home directory, or relative. */
  prefix: '/' | '~' | '';
  segments: string[];
}

export function splitPath(path: string): SplitPath {
  const prefix = path === '~' || path.startsWith('~/') ? '~' : path.startsWith('/') ? '/' : '';
  const body = prefix === '~' ? path.slice(1) : path;
  const segments: string[] = [];
  for (const segment of body.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') segments.pop();
      else if (prefix === '') segments.push('..');
      continue;
    }
    segments.push(segment);
  }
  return { prefix, segments };
}

export function joinSplit({ prefix, segments }: SplitPath): string {
  if (prefix === '/') return `/${segments.join('/')}`;
  if (prefix === '~') return segments.length > 0 ? `~/${segments.join('/')}` : '~';
  return segments.join('/') || '.';
}

/** `.` and `..` resolved, repeated slashes dropped, no trailing slash. */
export function normalizePath(path: string): string {
  return joinSplit(splitPath(path));
}

/** The last segment: a file's name, or a folder's. */
export function basename(path: string): string {
  const { prefix, segments } = splitPath(path);
  return segments[segments.length - 1] ?? (prefix || path);
}

/** The folder containing `path`, or null at a root. */
export function dirname(path: string): string | null {
  const { prefix, segments } = splitPath(path);
  if (segments.length === 0) return null;
  return joinSplit({ prefix, segments: segments.slice(0, -1) });
}

export function joinPath(dir: string, name: string): string {
  return normalizePath(`${dir}/${name}`);
}

/** `path` as printed in a shell whose directory is `cwd`. */
export function resolveAgainst(cwd: string, path: string): string {
  return splitPath(path).prefix ? normalizePath(path) : joinPath(cwd, path);
}

/** Whether `path` is `root` or inside it. */
export function isUnder(root: string, path: string): boolean {
  const r = normalizePath(root);
  const p = normalizePath(path);
  return p === r || p.startsWith(r === '/' ? '/' : `${r}/`);
}

/** `path` without `root` in front, when it is inside it; otherwise the path. */
export function relativeTo(root: string, path: string): string {
  const r = normalizePath(root);
  const p = normalizePath(path);
  if (p === r) return basename(p);
  if (!isUnder(r, p)) return p;
  return p.slice(r === '/' ? 1 : r.length + 1);
}

/** The folders strictly between `root` and `path`, nearest the root first. */
export function foldersBetween(root: string, path: string): string[] {
  if (!isUnder(root, path)) return [];
  const segments = relativeTo(root, path).split('/');
  const out: string[] = [];
  let dir = normalizePath(root);
  for (const segment of segments.slice(0, -1)) {
    dir = joinPath(dir, segment);
    out.push(dir);
  }
  return out;
}
