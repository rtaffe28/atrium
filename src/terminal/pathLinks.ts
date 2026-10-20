import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import type { FileStat } from '../host/types';
import { resolveAgainst } from '../paths';

/**
 * Paths in terminal output, as links.
 *
 * Agents print paths constantly — every file they edit, every error they
 * quote — and this is what makes them clickable, with the same modifier and
 * the same split as a URL. A word is a candidate if it is shaped like a
 * path; it is a link only if the host says it exists, so prose with a dot in
 * it is not underlined, and a path the agent is about to write is not yet.
 */

export interface PathCandidate {
  /** The token as printed, without a trailing `:line`. */
  text: string;
  /** Column of the first character, 0-based; `end` is one past the last. */
  start: number;
  end: number;
  line?: number;
}

const URL_RE = /[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi;

/**
 * Something with a slash in it, with or without a root and with or without
 * a trailing one, or a bare name with an extension that starts with a letter
 * — so `README.md` and `docs/plan/` are candidates and `v8.3.0` is not.
 */
const TOKEN =
  /(?:~|\.{1,2})?\/[^\s"'`<>|()[\]{}:]+|[\w.@+-]+(?:\/[\w.@+-]*)+|[\w@+-][\w@+.-]*\.[A-Za-z]\w{0,7}/g;

const LINE_SUFFIX = /^:(\d+)(?::\d+)?/;

export function findPathCandidates(text: string): PathCandidate[] {
  const urls = [...text.matchAll(URL_RE)].map((m) => [m.index, m.index + m[0].length] as const);
  const out: PathCandidate[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index;
    if (urls.some(([from, to]) => start < to && start + match[0].length > from)) continue;
    // Punctuation after a path is prose: "see src/foo.ts." and "(src/foo.ts)".
    const token = match[0].replace(/[.,;!?'"]+$/, '');
    if (!token || token === '/' || /^\.{1,2}$/.test(token)) continue;
    let end = start + token.length;
    let line: number | undefined;
    const suffix = LINE_SUFFIX.exec(text.slice(end));
    if (suffix) {
      line = Number(suffix[1]);
      end += suffix[0].length;
    }
    out.push({ text: token, start, end, line });
  }
  return out;
}

/** The path a `file:` URL names, or null for one that names another host. */
export function fileUrlPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return null;
    if (parsed.host && parsed.host !== 'localhost') return null;
    return decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
}

export interface PathLinkOptions {
  /** Where the shell is, which a relative path is read against. */
  cwd: () => string;
  stat: (path: string) => Promise<FileStat | null>;
  /** The link was clicked. The caller decides what the modifier means. */
  activate: (event: MouseEvent, path: string, line: number | undefined, directory: boolean) => void;
}

/** How long a stat answer is trusted; a file an agent creates is a link soon after. */
const CACHE_MS = 3000;

export function pathLinkProvider(term: Terminal, options: PathLinkOptions): ILinkProvider {
  const cache = new Map<string, { at: number; stat: Promise<FileStat | null> }>();
  const lookup = (path: string) => {
    const now = Date.now();
    const hit = cache.get(path);
    if (hit && now - hit.at < CACHE_MS) return hit.stat;
    if (cache.size > 500) cache.clear();
    const stat = options.stat(path).catch(() => null);
    cache.set(path, { at: now, stat });
    return stat;
  };

  return {
    provideLinks(y, callback) {
      const row = term.buffer.active.getLine(y - 1);
      const text = row?.translateToString(true) ?? '';
      const candidates = findPathCandidates(text);
      if (candidates.length === 0) {
        callback(undefined);
        return;
      }
      const cwd = options.cwd();
      void Promise.all(
        candidates.map(async (candidate): Promise<ILink | null> => {
          const path = resolveAgainst(cwd, candidate.text);
          const info = await lookup(path);
          if (!info || info.kind === 'other') return null;
          return {
            range: { start: { x: candidate.start + 1, y }, end: { x: candidate.end, y } },
            text: text.slice(candidate.start, candidate.end),
            activate: (event) =>
              options.activate(event, path, candidate.line, info.kind === 'directory'),
          };
        }),
      ).then((links) => {
        const found = links.filter((link): link is ILink => link !== null);
        callback(found.length > 0 ? found : undefined);
      });
    },
  };
}
