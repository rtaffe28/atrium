import type { FileContents, GitDriver, GitStatus } from '../types';
import type { AtriumBridge } from './bridge';

/** git, run in the main process. A machine without it answers null, as outside a repository. */
export class ElectronGit implements GitDriver {
  private bridge: AtriumBridge;

  constructor(bridge: AtriumBridge) {
    this.bridge = bridge;
  }

  status(dir: string): Promise<GitStatus | null> {
    return this.bridge.git.status(dir);
  }

  original(root: string, path: string): Promise<FileContents | null> {
    return this.bridge.git.original(root, path);
  }
}
