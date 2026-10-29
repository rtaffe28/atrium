import { isUnder, normalizePath, relativeTo } from '../../paths';
import { countChanges, diffLines } from '../../viewers/diff';
import type { FileContents, GitChange, GitDriver, GitStatus } from '../types';
import type { MockFiles } from './files';

/** What an explorer hides, git ignores here: the sample's .git and node_modules. */
const IGNORED = /(^|\/)(\.git|node_modules)(\/|$)/;

/**
 * A repository over the mock's files: HEAD is the tree as it was seeded, and
 * the working tree is the tree now. The scripted agent's edits are what
 * changed, so a changes tab in the browser build has something to show.
 */
export class MockGit implements GitDriver {
  private files: MockFiles;
  private root: string;
  private head: Map<string, string>;

  constructor(files: MockFiles, root: string) {
    this.files = files;
    this.root = root;
    this.head = new Map(files.entries());
  }

  async status(dir: string): Promise<GitStatus | null> {
    const root = normalizePath(this.root);
    if (!isUnder(root, normalizePath(dir))) return null;
    const now = new Map(this.files.entries());
    const tracked = (p: string) => isUnder(root, p) && !IGNORED.test(relativeTo(root, p));

    const changes: GitChange[] = [];
    for (const [path, text] of now) {
      if (!tracked(path)) continue;
      const before = this.head.get(path);
      if (before === text) continue;
      const binary = text.slice(0, 8000).includes('\0');
      const counts = binary ? { added: 0, removed: 0 } : countChanges(diffLines(before ?? '', text));
      changes.push({ path, kind: before === undefined ? 'untracked' : 'modified', ...counts, binary });
    }
    for (const [path, text] of this.head) {
      if (!tracked(path) || now.has(path)) continue;
      changes.push({ path, kind: 'deleted', added: 0, removed: countChanges(diffLines(text, '')).removed, binary: false });
    }
    changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { root, branch: 'main', changes, truncated: false };
  }

  async original(root: string, path: string): Promise<FileContents | null> {
    const p = normalizePath(path);
    if (!isUnder(normalizePath(root), p)) return null;
    const text = this.head.get(p);
    if (text === undefined) return null;
    if (text.slice(0, 8000).includes('\0')) return { kind: 'binary', size: text.length };
    return { kind: 'text', text, size: text.length, truncated: false };
  }
}
