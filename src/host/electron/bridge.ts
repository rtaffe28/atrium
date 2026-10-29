import type { AgentRequest } from '../../session/types';
import type {
  FileContents,
  FileEntry,
  FileEvent,
  FileStat,
  GitStatus,
  PersistedWorkspace,
} from '../types';

/** The shape the preload exposes. Kept here so the renderer has one source. */
export interface HostInfo {
  platform: 'mac' | 'win' | 'linux';
  /** Unpackaged run or installed app — `app.isPackaged`, as the renderer sees it. */
  build: 'dev' | 'release';
  insets: { lead: number; trail: number };
  home: string;
  shell: string;
  /**
   * Where the shims report what each tab is running.
   *
   * Reported rather than reconstructed. The renderer used to build this path
   * itself, from a macOS layout written as a string literal, while the main
   * process used Electron's own `userData` — so on Linux the app armed a
   * resume in one directory and told the shim to look in another. Two
   * derivations of one path is one too many.
   */
  sessionState: string;
}

export interface AtriumBridge {
  info(): Promise<HostInfo>;
  pty: {
    spawn(options: {
      id: string;
      cwd: string;
      cols: number;
      rows: number;
      shell?: string;
      args?: string[];
      env?: Record<string, string>;
    }): Promise<{ pid: number }>;
    replay(id: string): Promise<string>;
    foreground(): Promise<Record<string, string>>;
    write(id: string, data: string): void;
    resize(id: string, cols: number, rows: number): void;
    interrupt(id: string): void;
    kill(id: string): void;
    onData(handler: (id: string, data: string) => void): () => void;
    onExit(handler: (id: string, code: number) => void): () => void;
  };
  agent: {
    prepareSession(
      tabId: string,
      resume: { claude?: string; codex?: string },
      cwd?: string,
    ): Promise<string>;
    report(tabId: string): Promise<{ sessionId: string | null }>;
    newestCodexSession(since: number): Promise<string | null>;
    /** A program in a tab asked for something through the `atrium` command. */
    onRequest(handler: (tabId: string, request: AgentRequest) => void): () => void;
  };
  files: {
    choose(): Promise<string | null>;
    chooseFile(): Promise<string | null>;
    chooseAny(): Promise<string | null>;
    pathOf(file: File): string;
    stat(path: string): Promise<FileStat | null>;
    read(path: string, as?: 'text' | 'dataUrl'): Promise<FileContents>;
    list(dir: string): Promise<FileEntry[]>;
    /** Start watching `path` under `id`; events arrive on onChanged with it. */
    watch(id: number, path: string): Promise<void>;
    unwatch(id: number): void;
    onChanged(handler: (id: number, event: FileEvent) => void): () => void;
    openExternally(path: string): Promise<void>;
  };
  git: {
    status(dir: string): Promise<GitStatus | null>;
    original(root: string, path: string): Promise<FileContents | null>;
  };
  notify: {
    post(notice: { title: string; body: string; tag: string }): Promise<void>;
    /** Bounce the dock, or flash the taskbar entry, until the window is focused. */
    attention(): void;
    /** A posted notification was clicked; the window has already been raised. */
    onClick(handler: (tag: string) => void): () => void;
  };
  workspace: {
    load(): Promise<PersistedWorkspace | null>;
    save(state: PersistedWorkspace): Promise<void>;
  };
  surfaces: {
    /** A webview asked for a new window. Identified by its webContents id. */
    onOpen(handler: (webContentsId: number, url: string) => void): () => void;
  };
  window: {
    onState(handler: (state: { focused: boolean; fullscreen: boolean }) => void): () => void;
  };
}

declare global {
  interface Window {
    atrium?: AtriumBridge;
  }
}

/** Present only when running inside the Electron shell. */
export function getBridge(): AtriumBridge | null {
  return typeof window !== 'undefined' ? (window.atrium ?? null) : null;
}
