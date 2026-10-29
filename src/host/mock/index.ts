import { MockDriver } from '../../session/mock';
import type {
  Build,
  Capabilities,
  Host,
  Platform,
  Unsubscribe,
  WindowDriver,
  WindowState,
} from '../types';
import { MockFiles, SAMPLE_ROOT } from './files';
import { MockGit } from './git';
import { WebNotify } from './notify';
import { IframeSurfaces } from './surfaces';
import { LocalStorageWorkspace } from './workspace';

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

  build(): Build {
    // A browser tab only ever exists because someone ran `npm run dev`; the
    // bundler's own flag is the honest answer, and there is no installed
    // browser build for it to be confused with.
    return import.meta.env.DEV ? 'dev' : 'release';
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

export class MockHost implements Host {
  readonly name = 'mock';
  // The files first: the scripted agent writes into them.
  readonly files = new MockFiles();
  readonly git = new MockGit(this.files, SAMPLE_ROOT);
  readonly sessions = new MockDriver(this.files);
  readonly surfaces = new IframeSurfaces();
  readonly notify = new WebNotify();
  readonly window = new BrowserWindowDriver();
  readonly workspace = new LocalStorageWorkspace();

  readonly capabilities: Capabilities = {
    pty: false,
    browserSurface: 'iframe',
    nativeNotifications: typeof Notification !== 'undefined',
    customChrome: false,
    persistence: true,
    files: true,
    git: true,
  };
}
