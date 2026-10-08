import { contextBridge, ipcRenderer } from 'electron';

/**
 * The bridge.
 *
 * Everything here is async and serializable, because contextBridge cannot pass
 * functions, class instances or synchronous getters across the boundary. The
 * one exception is subscription: callbacks stay on this side and the bridge
 * hands back an unsubscribe closure.
 *
 * PTY output does not go through invoke/handle. It is pushed one way on its
 * own channel, because round-tripping every chunk of terminal output would
 * serialise the whole terminal behind the IPC queue.
 */

export interface HostInfo {
  platform: 'mac' | 'win' | 'linux';
  build: 'dev' | 'release';
  insets: { lead: number; trail: number };
  home: string;
  shell: string;
}

const bridge = {
  info: (): Promise<HostInfo> => ipcRenderer.invoke('host:info'),

  pty: {
    spawn: (options: {
      id: string;
      cwd: string;
      cols: number;
      rows: number;
      shell?: string;
      args?: string[];
      env?: Record<string, string>;
    }): Promise<{ pid: number }> => ipcRenderer.invoke('pty:spawn', options),

    replay: (id: string): Promise<string> => ipcRenderer.invoke('pty:replay', id),
    foreground: (): Promise<Record<string, string>> => ipcRenderer.invoke('pty:foreground'),

    write: (id: string, data: string) => ipcRenderer.send('pty:write', id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.send('pty:resize', id, cols, rows),
    interrupt: (id: string) => ipcRenderer.send('pty:interrupt', id),
    kill: (id: string) => ipcRenderer.send('pty:kill', id),

    onData: (handler: (id: string, data: string) => void) => {
      const listener = (_e: unknown, id: string, data: string) => handler(id, data);
      ipcRenderer.on('pty:data', listener);
      return () => ipcRenderer.off('pty:data', listener);
    },

    onExit: (handler: (id: string, code: number) => void) => {
      const listener = (_e: unknown, id: string, code: number) => handler(id, code);
      ipcRenderer.on('pty:exit', listener);
      return () => ipcRenderer.off('pty:exit', listener);
    },
  },

  agent: {
    prepareSession: (
      tabId: string,
      resume: { claude?: string; codex?: string },
      cwd?: string,
    ): Promise<string> => ipcRenderer.invoke('agent:prepare-session', tabId, resume, cwd),
    report: (tabId: string): Promise<{ sessionId: string | null }> =>
      ipcRenderer.invoke('agent:report', tabId),
    newestCodexSession: (since: number): Promise<string | null> =>
      ipcRenderer.invoke('agent:newest-codex-session', since),
  },

  files: {
    choose: (): Promise<string | null> => ipcRenderer.invoke('files:choose'),
  },

  notify: {
    post: (notice: { title: string; body: string; tag: string }): Promise<void> =>
      ipcRenderer.invoke('notify:post', notice),
    attention: () => ipcRenderer.send('notify:attention'),
    onClick: (handler: (tag: string) => void) => {
      const listener = (_e: unknown, tag: string) => handler(tag);
      ipcRenderer.on('notify:click', listener);
      return () => ipcRenderer.off('notify:click', listener);
    },
  },

  workspace: {
    load: (): Promise<unknown> => ipcRenderer.invoke('workspace:load'),
    save: (state: unknown): Promise<void> => ipcRenderer.invoke('workspace:save', state),
  },

  surfaces: {
    onOpen: (handler: (webContentsId: number, url: string) => void) => {
      const listener = (_e: unknown, id: number, url: string) => handler(id, url);
      ipcRenderer.on('surface:open', listener);
      return () => ipcRenderer.off('surface:open', listener);
    },
  },

  window: {
    onState: (handler: (state: { focused: boolean; fullscreen: boolean }) => void) => {
      const listener = (_e: unknown, state: { focused: boolean; fullscreen: boolean }) =>
        handler(state);
      ipcRenderer.on('window:state', listener);
      return () => ipcRenderer.off('window:state', listener);
    },
  },
};

export type AtriumBridge = typeof bridge;

contextBridge.exposeInMainWorld('atrium', bridge);
