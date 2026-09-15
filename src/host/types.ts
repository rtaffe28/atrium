/**
 * The host interface.
 *
 * Everything above this line is the app. Everything below it is the platform:
 * MockHost in a browser tab today, ElectronHost later, and whatever else after
 * that. The app is handed one Host object and never imports a platform module.
 *
 * Three rules keep this survivable when the boundary becomes real IPC:
 *
 *  1. **Async and serializable.** Electron's contextBridge cannot pass
 *     functions, class instances, or synchronous getters. Every method returns
 *     a promise, every payload is plain JSON, every event is a subscription.
 *     High-frequency PTY output gets its own channel rather than being pushed
 *     through request/response.
 *
 *  2. **Capability-checked.** The browser build is a supported target, not
 *     scaffolding. The app asks `host.capabilities` before offering an
 *     affordance instead of assuming, so a host that cannot do something
 *     degrades rather than throws.
 *
 *  3. **Injected, never imported.** One HostProvider at the root; components
 *     reach it with useHost(). That is what makes MockHost and ElectronHost
 *     interchangeable, and what lets one test suite run against both.
 */

import type { SessionDriver } from '../session/types';

export type Unsubscribe = () => void;

// ── capabilities ───────────────────────────────────────────────────────────

/**
 * What this host can actually do.
 *
 * Read this rather than sniffing the platform: two hosts on the same OS can
 * differ, and the app should react to the capability, not the guess.
 */
export interface Capabilities {
  /** Real processes on real pseudo-terminals. False means scripted output. */
  pty: boolean;
  /** How embedded web content renders, or 'none' if it cannot. */
  browserSurface: 'webview' | 'iframe' | 'none';
  /** Worktree and diff operations. */
  git: boolean;
  /** Reading, writing and watching files on disk. */
  files: boolean;
  /** OS-level notifications as opposed to in-app ones. */
  nativeNotifications: boolean;
  /** Frameless window with app-drawn chrome. */
  customChrome: boolean;
}

// ── surfaces ───────────────────────────────────────────────────────────────

export type SurfaceEvent =
  | { type: 'title'; title: string }
  | { type: 'url'; url: string }
  | { type: 'loading'; loading: boolean }
  | { type: 'error'; message: string };

/**
 * Embedded web content.
 *
 * This driver inverts the pattern deliberately. Everything else in Host is
 * *data* the app renders; a surface is *an element the host owns*. The app
 * gives it a container and the host fills it — an iframe here, a <webview>
 * under Electron — so `mount` is the one place a DOM node crosses the
 * boundary. That is fine: surfaces are renderer-side on every host we plan to
 * support. Only the control and event traffic below ever needs to be IPC.
 */
export interface SurfaceDriver {
  mount(id: string, container: HTMLElement, options: { url?: string }): Unsubscribe;
  navigate(id: string, url: string): Promise<void>;
  reload(id: string): Promise<void>;
  back(id: string): Promise<void>;
  forward(id: string): Promise<void>;
  subscribe(id: string, handler: (event: SurfaceEvent) => void): Unsubscribe;
}

// ── git ────────────────────────────────────────────────────────────────────

export interface Worktree {
  path: string;
  branch: string;
  head: string;
  dirty: boolean;
}

export interface GitDriver {
  listWorktrees(repo: string): Promise<Worktree[]>;
  createWorktree(repo: string, branch: string): Promise<Worktree>;
  removeWorktree(path: string): Promise<void>;
  diffStat(path: string): Promise<{ files: number; added: number; removed: number }>;
}

// ── files ──────────────────────────────────────────────────────────────────

export interface FileDriver {
  read(path: string): Promise<string>;
  write(path: string, contents: string): Promise<void>;
  watch(path: string, handler: (path: string) => void): Unsubscribe;
}

// ── notifications ──────────────────────────────────────────────────────────

export type NotifyKind = 'done' | 'waiting' | 'error';

export interface NotifyDriver {
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  /** Post a notification. Silent if permission was never granted. */
  post(notice: { kind: NotifyKind; title: string; body: string; tag: string }): Promise<void>;
  /** Play the alert tone for a state, independent of notification permission. */
  sound(kind: NotifyKind): void;
}

// ── window ─────────────────────────────────────────────────────────────────

export type Platform = 'mac' | 'win' | 'linux';

export interface WindowState {
  focused: boolean;
  fullscreen: boolean;
}

export interface WindowDriver {
  platform(): Platform;
  /**
   * Space to leave clear of the OS window controls, in CSS pixels.
   *
   * macOS puts traffic lights top-left, Windows and Linux put their controls
   * top-right. Asking the host means the app never sniffs a user agent.
   */
  chromeInsets(): { lead: number; trail: number };
  subscribe(handler: (state: WindowState) => void): Unsubscribe;
}

// ── the host ───────────────────────────────────────────────────────────────

export interface Host {
  readonly name: string;
  readonly capabilities: Capabilities;
  readonly sessions: SessionDriver;
  readonly surfaces: SurfaceDriver;
  readonly git: GitDriver;
  readonly files: FileDriver;
  readonly notify: NotifyDriver;
  readonly window: WindowDriver;
}

/** Thrown by a driver whose capability flag is false. */
export class UnsupportedError extends Error {
  constructor(capability: keyof Capabilities) {
    super(`This host does not support "${capability}"`);
    this.name = 'UnsupportedError';
  }
}
