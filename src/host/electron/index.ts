import type {
  FileDriver,
  PersistedWorkspace,
  WorkspaceDriver,
  Capabilities,
  Host,
  NotifyDriver,
  NotifyKind,
  Platform,
  Unsubscribe,
  WindowDriver,
  WindowState,
} from '../types';
import type { AtriumBridge, HostInfo } from './bridge';
import { ElectronSessionDriver, type RestoreInput } from './session';
import { WebviewSurfaces } from './surfaces';

/** The chime generator is identical on every host; only delivery differs. */
import { WebNotify } from '../mock/notify';

class NativeNotify implements NotifyDriver {
  private tones = new WebNotify();
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

  async post(notice: { kind: NotifyKind; title: string; body: string; tag: string }) {
    await this.bridge.notify.post({
      title: notice.title,
      body: notice.body,
      tag: notice.tag,
    });
  }

  sound(kind: NotifyKind) {
    this.tones.sound(kind);
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
}

export class ElectronHost implements Host {
  readonly name = 'electron';
  readonly sessions: ElectronSessionDriver;
  readonly surfaces = new WebviewSurfaces();
  readonly files: ElectronFiles;
  readonly notify: NativeNotify;
  readonly window: ElectronWindowDriver;
  readonly workspace: FileWorkspace;
  readonly capabilities: Capabilities;

  constructor(bridge: AtriumBridge, info: HostInfo, restore?: RestoreInput) {
    this.sessions = new ElectronSessionDriver(bridge, info.home, info.shell, restore);
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
