import { joinPath, normalizePath } from '../../paths';
import type {
  FileContents,
  FileDriver,
  FileEntry,
  FileEvent,
  FileStat,
  Unsubscribe,
} from '../types';

const HIDDEN_ALWAYS = new Set(['.DS_Store', '.git', 'node_modules']);
const MAX_TEXT = 512 * 1024;

/** Enough of a repository to design a viewer against. */
const SAMPLE: Record<string, string> = {
  'README.md': `# atrium

A desktop workspace for running several coding agents in parallel — one window,
a rail of sessions, each a real terminal in a directory you choose.

## Running it

\`\`\`sh
npm install
npm run dev       # design loop in a browser tab, MockHost
npm run electron  # the real app: real PTYs
\`\`\`

- [ ] Stage 7: lifecycle
- [x] Stage 6.5: settings and persistence

See [the plans](docs/plan/README.md) for what is still open.
`,
  'package.json': `{
  "name": "atrium",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "test": "vitest run"
  }
}
`,
  '.gitignore': `node_modules
dist
dist-electron
release
`,
  'docs/plan/README.md': `# Plans

Split by whether there is work left, not by age.
`,
  'docs/plan/active/00-overview.md': `# Atrium — overview

A desktop workspace for running several coding agents in parallel.
`,
  'docs/plan/active/15-file-viewer.md': `# A file viewer

**Status: being built.** The tab you are reading this in.
`,
  'src/App.tsx': `import { useState } from 'react';
import { Sidebar } from './components/Sidebar';

export default function App() {
  const [activeId, setActiveId] = useState<string | null>(null);
  return <Sidebar activeId={activeId} onSelect={setActiveId} />;
}
`,
  'src/index.css': `:root {
  --bg: #0d0f12;
  --panel: #101318;
  --accent: #7aa2f7;
}

body { margin: 0; background: var(--bg); }
`,
  'src/components/Sidebar.tsx': `import type { Session } from '../session/types';

interface Props {
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

/** The session rail. Also a drop target: a tab dropped here becomes a session. */
export function Sidebar({ sessions, activeId, onSelect }: Props) {
  return (
    <aside className="sidebar">
      {sessions.map((session) => (
        <button
          key={session.id}
          className={session.id === activeId ? 'session-row is-active' : 'session-row'}
          onClick={() => onSelect(session.id)}
        >
          {session.title}
        </button>
      ))}
    </aside>
  );
}
`,
  'src/components/TerminalView.tsx': `import { Terminal } from '@xterm/xterm';

/** One xterm instance per mounted tab. */
export function TerminalView({ tabId }: { tabId: string }) {
  const term = new Terminal({ scrollback: 10_000 });
  return <div className="terminal-host" data-tab-id={tabId} ref={(el) => el && term.open(el)} />;
}
`,
  'src/session/types.ts': `export type TabKind = 'terminal' | 'browser' | 'file';

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  /** File tabs only. */
  path?: string;
}
`,
  'src/session/store.ts': `import type { Tab } from './types';

let counter = 0;
export const uid = (prefix: string) => \`\${prefix}\${++counter}\`;

export function makeTab(kind: Tab['kind']): Tab {
  return { id: uid('t'), kind, title: kind };
}
`,
  'public/favicon.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#7aa2f7"/></svg>
`,
  'build/icon.png': '\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x10\0\0\0\x10',
  'node_modules/react/index.js': 'module.exports = require("./cjs/react.production.js");\n',
  '.git/HEAD': 'ref: refs/heads/main\n',
};

/** The sample repository's root in the mock's sessions. */
export const SAMPLE_ROOT = '~/git/atrium';

/** Folders first, then files, both alphabetical: as an explorer reads. */
function sortEntries(entries: FileEntry[]): FileEntry[] {
  return entries.sort((a, b) =>
    a.directory === b.directory ? a.name.localeCompare(b.name) : a.directory ? -1 : 1,
  );
}

/**
 * A filesystem that is a map.
 *
 * Enough to design against: a few directories deep, a README, some source,
 * a binary, and the entries an explorer hides. The scripted agent writes into
 * it, so a viewer open on a file sees it change the way it would on disk.
 */
export class MockFiles implements FileDriver {
  private files = new Map<string, string>();
  private listeners = new Map<string, Set<(event: FileEvent) => void>>();

  constructor(seed: Record<string, string> = SAMPLE, root = SAMPLE_ROOT) {
    for (const [path, text] of Object.entries(seed)) this.files.set(joinPath(root, path), text);
  }

  /** No native dialog in a browser tab. */
  async chooseDirectory(): Promise<string | null> {
    return null;
  }

  async chooseFile(): Promise<string | null> {
    return null;
  }

  async chooseAny(): Promise<string | null> {
    return null;
  }

  /** A browser is handed a dropped file's bytes, never its path. */
  pathOf(_file: File): string | null {
    return null;
  }

  private isDirectory(path: string): boolean {
    const prefix = path === '/' ? '/' : `${path}/`;
    for (const key of this.files.keys()) if (key.startsWith(prefix)) return true;
    return false;
  }

  async stat(path: string): Promise<FileStat | null> {
    const p = normalizePath(path);
    const text = this.files.get(p);
    if (text !== undefined) return { kind: 'file', size: text.length, mtime: 0 };
    if (this.isDirectory(p)) return { kind: 'directory', size: 0, mtime: 0 };
    return null;
  }

  async read(path: string, as: 'text' | 'dataUrl' = 'text'): Promise<FileContents> {
    const p = normalizePath(path);
    const text = this.files.get(p);
    if (text === undefined) throw new Error(`No such file: ${path}`);
    if (as === 'dataUrl') {
      return { kind: 'dataUrl', dataUrl: `data:text/plain;base64,${btoa(text)}`, size: text.length };
    }
    if (text.slice(0, 8000).includes('\0')) return { kind: 'binary', size: text.length };
    return {
      kind: 'text',
      text: text.slice(0, MAX_TEXT),
      size: text.length,
      truncated: text.length > MAX_TEXT,
    };
  }

  async list(dir: string): Promise<FileEntry[]> {
    const d = normalizePath(dir);
    if (!this.isDirectory(d)) throw new Error(`No such directory: ${dir}`);
    const prefix = d === '/' ? '/' : `${d}/`;
    const seen = new Map<string, boolean>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf('/');
      const name = slash < 0 ? rest : rest.slice(0, slash);
      if (HIDDEN_ALWAYS.has(name)) continue;
      seen.set(name, slash >= 0 || seen.get(name) === true);
    }
    return sortEntries(
      [...seen].map(([name, directory]) => ({ name, path: joinPath(d, name), directory })),
    );
  }

  watch(path: string, handler: (event: FileEvent) => void): Unsubscribe {
    const p = normalizePath(path);
    let set = this.listeners.get(p);
    if (!set) {
      set = new Set();
      this.listeners.set(p, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
      if (set.size === 0) this.listeners.delete(p);
    };
  }

  async openExternally(): Promise<void> {
    // Nowhere to open it in a browser tab.
  }

  /** Every file and what it says, for the mock's git to compare. */
  entries(): [string, string][] {
    return [...this.files];
  }

  private emit(path: string, event: FileEvent): void {
    for (const handler of this.listeners.get(path) ?? []) handler(event);
  }

  /** Tell the folders above `path` their listing changed. */
  private emitAbove(path: string): void {
    let dir = path;
    for (;;) {
      const slash = dir.lastIndexOf('/');
      if (slash <= 0) break;
      dir = dir.slice(0, slash);
      this.emit(dir, { type: 'changed' });
    }
  }

  // ── what the scripted agent does ─────────────────────────────────────────

  /** Rewrite a file, or create it. The watchers hear about it as from disk. */
  write(path: string, text: string): void {
    const p = normalizePath(path);
    const existed = this.files.has(p);
    this.files.set(p, text);
    this.emit(p, { type: 'changed' });
    if (!existed) this.emitAbove(p);
  }

  /** Add to the end of a file, creating it if it is not there. */
  append(path: string, text: string): void {
    this.write(path, (this.files.get(normalizePath(path)) ?? '') + text);
  }

  remove(path: string): void {
    const p = normalizePath(path);
    if (!this.files.delete(p)) return;
    this.emit(p, { type: 'deleted' });
    this.emitAbove(p);
  }
}
