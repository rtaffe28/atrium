import { MockDriver } from '../../session/mock';
import type {
  Capabilities,
  FileDriver,
  GitDriver,
  Host,
  Platform,
  Unsubscribe,
  WindowDriver,
  WindowState,
  Worktree,
} from '../types';
import { UnsupportedError } from '../types';
import { WebNotify } from './notify';
import { IframeSurfaces } from './surfaces';

/** Platform detection stays here so no component ever sniffs a user agent. */
function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'linux';
  const ua = navigator.userAgent;
  if (ua.includes('Mac')) return 'mac';
  if (ua.includes('Win')) return 'win';
  return 'linux';
}

class BrowserWindowDriver implements WindowDriver {
  platform(): Platform {
    return detectPlatform();
  }

  chromeInsets() {
    // In a browser tab there are no OS window controls to avoid. The values a
    // frameless Electron window needs live in ElectronHost; the app just reads
    // whatever it is told.
    return { lead: 0, trail: 0 };
  }

  subscribe(handler: (state: WindowState) => void): Unsubscribe {
    const emit = () =>
      handler({ focused: document.hasFocus(), fullscreen: Boolean(document.fullscreenElement) });
    window.addEventListener('focus', emit);
    window.addEventListener('blur', emit);
    document.addEventListener('fullscreenchange', emit);
    emit();
    return () => {
      window.removeEventListener('focus', emit);
      window.removeEventListener('blur', emit);
      document.removeEventListener('fullscreenchange', emit);
    };
  }
}

/**
 * Worktrees that exist only in memory.
 *
 * Deliberately implemented rather than stubbed out: it keeps the git surface
 * honest and gives the UI something to render before any real git exists.
 */
class FakeGit implements GitDriver {
  private worktrees = new Map<string, Worktree>();

  async listWorktrees(repo: string): Promise<Worktree[]> {
    return [...this.worktrees.values()].filter((w) => w.path.startsWith(repo));
  }

  async createWorktree(repo: string, branch: string): Promise<Worktree> {
    const worktree: Worktree = {
      path: `${repo}/../worktrees/${branch.replace(/\//g, '-')}`,
      branch,
      head: Math.random().toString(16).slice(2, 9),
      dirty: false,
    };
    this.worktrees.set(worktree.path, worktree);
    return worktree;
  }

  async removeWorktree(path: string): Promise<void> {
    this.worktrees.delete(path);
  }

  async diffStat() {
    return { files: 0, added: 0, removed: 0 };
  }
}

/** No filesystem in a browser tab. Capabilities say so; these throw if called. */
class NoFiles implements FileDriver {
  async read(_path: string): Promise<string> {
    throw new UnsupportedError('files');
  }
  async write(_path: string, _contents: string): Promise<void> {
    throw new UnsupportedError('files');
  }
  watch(_path: string, _handler: (path: string) => void): Unsubscribe {
    throw new UnsupportedError('files');
  }
}

export class MockHost implements Host {
  readonly name = 'mock';
  readonly sessions = new MockDriver();
  readonly surfaces = new IframeSurfaces();
  readonly git = new FakeGit();
  readonly files = new NoFiles();
  readonly notify = new WebNotify();
  readonly window = new BrowserWindowDriver();

  readonly capabilities: Capabilities = {
    pty: false,
    browserSurface: 'iframe',
    git: true,
    files: false,
    nativeNotifications: typeof Notification !== 'undefined',
    customChrome: false,
  };
}
