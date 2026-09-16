import type { FileContents, FileDriver, FileEntry } from '../types';

/**
 * A small tree with no disk behind it.
 *
 * Enough to lay out and judge the explorer in a browser tab, which is the
 * point of MockHost — the design loop should not need a packaged app.
 */
const TREE: Record<string, FileEntry[]> = {
  '~': [
    { name: 'src', path: '~/src', directory: true },
    { name: 'electron', path: '~/electron', directory: true },
    { name: 'package.json', path: '~/package.json', directory: false },
    { name: 'README.md', path: '~/README.md', directory: false },
  ],
  '~/src': [
    { name: 'session', path: '~/src/session', directory: true },
    { name: 'App.tsx', path: '~/src/App.tsx', directory: false },
    { name: 'index.css', path: '~/src/index.css', directory: false },
  ],
  '~/src/session': [{ name: 'store.ts', path: '~/src/session/store.ts', directory: false }],
  '~/electron': [{ name: 'main.ts', path: '~/electron/main.ts', directory: false }],
};

const FILES: Record<string, string> = {
  '~/package.json': '{\n  "name": "atrium",\n  "version": "0.1.0"\n}\n',
  '~/README.md': '# atrium\n\nA desktop workspace for running several coding\nagents in parallel.\n',
  '~/src/App.tsx': "export default function App() {\n  return <Workspace />;\n}\n",
  '~/src/index.css': ':root {\n  --accent: #7aa2f7;\n}\n',
  '~/src/session/store.ts': 'export abstract class SessionStore {\n  // sessions, tabs, layout\n}\n',
  '~/electron/main.ts': "app.whenReady().then(() => createWindow());\n",
};

export class MockFiles implements FileDriver {
  async list(path: string): Promise<FileEntry[]> {
    return TREE[path] ?? TREE['~'];
  }

  async read(path: string): Promise<FileContents> {
    return { text: FILES[path] ?? '', truncated: false };
  }
}
