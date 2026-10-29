import { watch, type FSWatcher } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WebContents } from 'electron';
import { expandHome } from './files';

/**
 * What the programs in tabs ask for, through the `atrium` command.
 *
 * The command writes a file into the tab's state directory; this reads it,
 * deletes it, checks it, and tells the renderer — or declines, with a line in
 * the tab's log. The set of verbs is closed and nothing flows back. What a
 * program can ask for is what a Cmd-click on a link it printed would do: a
 * tab beside its own. See docs/plan/active/15-file-viewer.md.
 *
 * These shapes are the renderer's, kept in step by hand.
 */

export type FileTarget =
  | { kind: 'file'; path: string; line?: number }
  | { kind: 'folder'; root: string };

export type AgentRequest =
  | { verb: 'open'; url: string }
  | { verb: 'open'; target: FileTarget }
  | { verb: 'diff'; root: string; path?: string };

export interface ParsedRequest {
  verb: string;
  /** The lines after the verb. */
  args: string[];
}

/** The first line is the verb; the rest is the argument, as written. */
export function parseRequest(text: string): ParsedRequest | null {
  const lines = text.replace(/\n$/, '').split('\n');
  const verb = lines[0]?.trim();
  if (!verb) return null;
  return { verb, args: lines.slice(1) };
}

export type Outcome = { request: AgentRequest } | { refused: string };

/** An `open` argument as the app will act on it, or why it will not. */
export async function classifyOpen(arg: string, home: string): Promise<Outcome> {
  const trimmed = arg.trim();
  if (/^https?:\/\//i.test(trimmed)) return { request: { verb: 'open', url: trimmed } };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return { refused: `only http(s) URLs open: ${trimmed}` };
  if (!trimmed) return { refused: 'nothing to open' };

  const asGiven = expandHome(trimmed, home);
  const info = await stat(asGiven).catch(() => null);
  if (info) return describe(asGiven, info.isFile(), info.isDirectory(), undefined, trimmed);

  // `path:12`, as an agent quotes an error — unless the file is really called that.
  const suffixed = /^(.*?):(\d+)(?::\d+)?$/.exec(asGiven);
  if (suffixed) {
    const line = Number(suffixed[2]);
    const again = await stat(suffixed[1]).catch(() => null);
    if (again) return describe(suffixed[1], again.isFile(), again.isDirectory(), line, trimmed);
  }
  return { refused: `no such file or folder: ${trimmed}` };
}

function describe(p: string, file: boolean, directory: boolean, line: number | undefined, asked: string): Outcome {
  if (directory) return { request: { verb: 'open', target: { kind: 'folder', root: p } } };
  if (file) {
    return {
      request: {
        verb: 'open',
        target: { kind: 'file', path: p, ...(line !== undefined && file ? { line } : {}) },
      },
    };
  }
  return { refused: `not a file or folder: ${asked}` };
}

/**
 * A `diff` argument: a folder is the repository to show, a file is the file
 * to show it on. Whether it is in a repository is the tab's to say.
 */
export async function classifyDiff(arg: string, home: string): Promise<Outcome> {
  const trimmed = arg.trim();
  if (!trimmed) return { refused: 'nothing to diff' };
  const p = expandHome(trimmed, home);
  const info = await stat(p).catch(() => null);
  if (info?.isDirectory()) return { request: { verb: 'diff', root: p } };
  if (info?.isFile()) return { request: { verb: 'diff', root: path.dirname(p), path: p } };
  // A file the agent deleted is a change worth showing, and its folder says where.
  const parent = await stat(path.dirname(p)).catch(() => null);
  if (parent?.isDirectory()) return { request: { verb: 'diff', root: path.dirname(p), path: p } };
  return { refused: `no such file or folder: ${trimmed}` };
}

/**
 * Watches every tab's `requests/` under the sessions directory.
 *
 * One recursive watch over the root rather than one per tab: tabs come and go
 * with the workspace, and the directory for a tab exists before its shell
 * does. A sweep on start picks up anything written while the app was not
 * looking.
 */
export class RequestWatcher {
  private watcher: FSWatcher | null = null;
  /** Requests being acted on. A second look at one waits for the first. */
  private handling = new Map<string, Promise<void>>();

  constructor(
    private root: string,
    private home: string,
    private send: (tabId: string, request: AgentRequest) => void,
  ) {}

  bind(contents: WebContents): void {
    this.send = (tabId, request) => {
      if (!contents.isDestroyed()) contents.send('agent:request', tabId, request);
    };
  }

  async start(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    this.watcher = watch(this.root, { recursive: true, persistent: false }, (_type, filename) => {
      if (filename) this.changed(String(filename));
    });
    this.watcher.on('error', () => {});
    await this.sweep();
  }

  close(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  /**
   * Anything under `<tab>/requests` means: look at that directory. The event
   * may name the file, or — when FSEvents coalesces a burst of them — only
   * the directory, so the directory is listed either way and whatever is
   * there is handled; dot names are still being written.
   */
  private changed(relative: string): void {
    const parts = relative.split(path.sep);
    if (parts.length < 2 || parts[1] !== 'requests') return;
    void this.sweepTab(parts[0]);
  }

  private async sweep(): Promise<void> {
    const tabs = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    for (const tab of tabs) if (tab.isDirectory()) await this.sweepTab(tab.name);
  }

  private async sweepTab(tabId: string): Promise<void> {
    const dir = path.join(this.root, tabId, 'requests');
    const names = await readdir(dir).catch(() => []);
    for (const name of names.sort()) {
      if (!name.startsWith('.')) await this.handle(tabId, path.join(dir, name));
    }
  }

  /**
   * The sweep and the watch can both find one request — FSEvents reports
   * files written just before a watch began — so whichever is second waits
   * for the first rather than acting twice or returning before it is done.
   */
  private handle(tabId: string, file: string): Promise<void> {
    const inFlight = this.handling.get(file);
    if (inFlight) return inFlight;
    const work = (async () => {
      try {
        const text = await readFile(file, 'utf8').catch(() => null);
        if (text === null) return; // taken already, or gone
        await rm(file, { force: true });
        const parsed = parseRequest(text);
        if (parsed) await this.act(tabId, parsed);
      } finally {
        this.handling.delete(file);
      }
    })();
    this.handling.set(file, work);
    return work;
  }

  private async act(tabId: string, { verb, args }: ParsedRequest): Promise<void> {
    const dir = path.join(this.root, tabId);
    if (verb === 'open') {
      const outcome = await classifyOpen(args.join('\n'), this.home);
      if ('request' in outcome) this.send(tabId, outcome.request);
      else await this.log(dir, `open refused: ${outcome.refused}`);
      return;
    }
    if (verb === 'diff') {
      const outcome = await classifyDiff(args.join('\n'), this.home);
      if ('request' in outcome) this.send(tabId, outcome.request);
      else await this.log(dir, `diff refused: ${outcome.refused}`);
      return;
    }
    if (verb === 'report') {
      // Kept for the rail to read. Main writes the JSON: a shell script
      // producing JSON is a thing to remove, not to be careful about.
      const [key, ...rest] = args;
      if (!key?.trim()) {
        await this.log(dir, 'report refused: no key');
        return;
      }
      const file = path.join(dir, 'meta.json');
      let meta: Record<string, string> = {};
      try {
        meta = JSON.parse(await readFile(file, 'utf8')) as Record<string, string>;
      } catch {
        // Missing, or not ours to parse: start again.
      }
      meta[key.trim()] = rest.join('\n');
      await writeFile(file, JSON.stringify(meta, null, 2), 'utf8').catch(() => {});
      return;
    }
    // An older app and a newer command fail quietly rather than strangely.
    await this.log(dir, `unknown request: ${verb}`);
  }

  private log(dir: string, line: string): Promise<void> {
    return appendFile(path.join(dir, 'log'), `${new Date().toISOString()} ${line}\n`).catch(() => {});
  }
}
