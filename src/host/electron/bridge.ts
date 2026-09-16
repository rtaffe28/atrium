import type { PersistedWorkspace } from '../types';

/** The shape the preload exposes. Kept here so the renderer has one source. */
export interface HostInfo {
  platform: 'mac' | 'win' | 'linux';
  insets: { lead: number; trail: number };
  home: string;
  shell: string;
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
    prepareSession(tabId: string, resume: { claude?: string; codex?: string }): Promise<string>;
    currentSession(tabId: string): Promise<string | null>;
    newestCodexSession(since: number): Promise<string | null>;
  };
  files: {
    choose(): Promise<string | null>;
  };
  notify: { post(notice: { title: string; body: string; tag: string }): Promise<void> };
  workspace: {
    load(): Promise<PersistedWorkspace | null>;
    save(state: PersistedWorkspace): Promise<void>;
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
