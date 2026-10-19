import type {
  Build,
  FileDriver,
  PersistedWorkspace,
  WorkspaceDriver,
  Capabilities,
  Host,
  NotifyDriver,
  Platform,
  Unsubscribe,
  WindowDriver,
  WindowState,
} from '../types';
import type { AtriumBridge, HostInfo } from './bridge';
import { ElectronSessionDriver, type RestoreInput } from './session';
import { WebviewSurfaces } from './surfaces';

/** The tone is identical on every host; only delivery differs. */
import { bellTone } from '../mock/notify';

class NativeNotify implements NotifyDriver {
  private bridge: AtriumBridge;

  constructor(bridge: AtriumBridge) {
    this.bridge = bridge;
  }

  permission(): NotificationPermission {
    return 'granted'; // the OS decides, and Electron does not gate on a prompt
  }

  async requestPermission(): Promise<NotificationPermission> {
    return 'granted';
  }

  async post(notice: { title: string; body: string; tag: string }) {
    await this.bridge.notify.post(notice);
  }

  bell() {
    bellTone();
  }

  attention() {
    this.bridge.notify.attention();
  }

  onClick(handler: (tag: string) => void): Unsubscribe {
    return this.bridge.notify.onClick(handler);
  }
}

class ElectronWindowDriver implements WindowDriver {
  private bridge: AtriumBridge;
  private info: HostInfo;

  constructor(bridge: AtriumBridge, info: HostInfo) {
    this.bridge = bridge;
    this.info = info;
  }

  platform(): Platform {
    return this.info.platform;
  }

  build(): Build {
    return this.info.build;
  }

  chromeInsets() {
    return this.info.insets;
  }

  subscribe(handler: (state: WindowState) => void): Unsubscribe {
    return this.bridge.window.onState(handler);
  }
}

/** Workspace state as a JSON file in the app's userData directory. */
class FileWorkspace implements WorkspaceDriver {
  // Roomier than localStorage: this is a file on disk, and a long scrollback
  // is what makes a restored pane read as continuous rather than truncated.
  readonly scrollbackBudget = 256_000;
  private bridge: AtriumBridge;

  constructor(bridge: AtriumBridge) {
    this.bridge = bridge;
  }

  load(): Promise<PersistedWorkspace | null> {
    return this.bridge.workspace.load();
  }

  save(state: PersistedWorkspace): Promise<void> {
    return this.bridge.workspace.save(state);
  }
}

/** The native folder dialog lives in the main process. */
class ElectronFiles implements FileDriver {
  private bridge: AtriumBridge;

  constructor(bridge: AtriumBridge) {
    this.bridge = bridge;
  }

  chooseDirectory() {
    return this.bridge.files.choose();
  }

  pathOf(file: File): string | null {
    try {
      return this.bridge.files.pathOf(file) || null;
    } catch {
      // A File that did not come from disk — one a page built — has no path.
      return null;
    }
  }
}

export class ElectronHost implements Host {
  readonly name = 'electron';
  readonly sessions: ElectronSessionDriver;
  readonly surfaces: WebviewSurfaces;
  readonly files: ElectronFiles;
  readonly notify: NativeNotify;
  readonly window: ElectronWindowDriver;
  readonly workspace: FileWorkspace;
  readonly capabilities: Capabilities;

  constructor(bridge: AtriumBridge, info: HostInfo, restore?: RestoreInput) {
    this.sessions = new ElectronSessionDriver(bridge, info.home, info.shell, info.sessionState, restore);
    this.surfaces = new WebviewSurfaces(bridge);
    this.workspace = new FileWorkspace(bridge);
    this.files = new ElectronFiles(bridge);
    this.notify = new NativeNotify(bridge);
    this.window = new ElectronWindowDriver(bridge, info);
    this.capabilities = {
      pty: true,
      browserSurface: 'webview',
      // Both are real capabilities of this host that are simply not built yet.
      // Saying false is the honest answer and keeps the UI from offering them.
      nativeNotifications: true,
      customChrome: true,
      persistence: true,
    };
  }
}
