import { MockDriver } from '../../session/mock';
import type {
  Capabilities,
  FileDriver,
  Host,
  Platform,
  Unsubscribe,
  WindowDriver,
  WindowState,
} from '../types';
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

/** No native dialog in a browser tab, so the one root is the only answer. */
class BrowserFiles implements FileDriver {
  async chooseDirectory(): Promise<string | null> {
    return null;
  }
}

export class MockHost implements Host {
  readonly name = 'mock';
  readonly sessions = new MockDriver();
  readonly surfaces = new IframeSurfaces();
  readonly files = new BrowserFiles();
  readonly notify = new WebNotify();
  readonly window = new BrowserWindowDriver();
  readonly workspace = new LocalStorageWorkspace();

  readonly capabilities: Capabilities = {
    pty: false,
    browserSurface: 'iframe',
    nativeNotifications: typeof Notification !== 'undefined',
    customChrome: false,
    persistence: true,
  };
}
