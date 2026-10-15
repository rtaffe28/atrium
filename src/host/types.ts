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

import type { Session, SessionDriver } from '../session/types';

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
  /** OS-level notifications as opposed to in-app ones. */
  nativeNotifications: boolean;
  /** Frameless window with app-drawn chrome. */
  customChrome: boolean;
  /** Restoring the workspace across restarts. */
  persistence: boolean;
}

// ── surfaces ───────────────────────────────────────────────────────────────

export type SurfaceEvent =
  | { type: 'title'; title: string }
  /**
   * The page is at `url` now, with whether it has anywhere to go back or
   * forward to. Reported, never requested: a clicked link, a redirect, a hash
   * change. The app records it and does not send it back — see HostSurface.
   */
  | { type: 'url'; url: string; canGoBack: boolean; canGoForward: boolean }
  | { type: 'loading'; loading: boolean }
  | { type: 'error'; message: string }
  /** The page asked for a link in a new tab: a Cmd/Ctrl-click, or target=_blank. */
  | { type: 'open'; url: string };

/**
 * Embedded web content.
 *
 * This driver inverts the pattern deliberately. Everything else in Host is
 * *data* the app renders; a surface is *an element the host owns*. The app
 * gives it a container and the host fills it — an iframe here, a <webview>
 * under Electron — so `mount` is the one place a DOM node crosses the
 * boundary. That is fine: surfaces are renderer-side on every host we plan to
 * support. Only the control and event traffic below ever needs to be IPC.
 *
 * Control runs one way: the methods ask the surface to go somewhere, the
 * `url` event says where it went. Nothing feeds the second back into the
 * first — a surface told to go where it already is reloads.
 */
export interface SurfaceDriver {
  mount(id: string, container: HTMLElement, options: { url?: string }): Unsubscribe;
  /** Load `url`, as entering it in the address bar does. */
  navigate(id: string, url: string): Promise<void>;
  reload(id: string): Promise<void>;
  back(id: string): Promise<void>;
  forward(id: string): Promise<void>;
  /** Open the page's developer tools, or close them if they are open. */
  toggleDevTools(id: string): Promise<void>;
  subscribe(id: string, handler: (event: SurfaceEvent) => void): Unsubscribe;
}

// ── choosing a folder ──────────────────────────────────────────────────────

/**
 * Asking the user for a directory, natively.
 *
 * Resolves to null if they cancel. Typing a path into a text field is the
 * worse half of this — it is the only way to reach a folder you cannot spell
 * from memory.
 */
export interface FileDriver {
  chooseDirectory(): Promise<string | null>;
}

// ── notifications ──────────────────────────────────────────────────────────

/**
 * Getting the human's attention, the way a terminal does.
 *
 * What to say comes from the program in the tab; when to say it is the app's
 * call. This is only delivery.
 */
export interface NotifyDriver {
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  /**
   * A desktop notification. Silent if permission was never granted.
   *
   * `tag` comes back through onClick, which is how a click finds its tab.
   */
  post(notice: { title: string; body: string; tag: string }): Promise<void>;
  /** The audible bell. */
  bell(): void;
  /** Ask for a look without words: a dock bounce, a flashing taskbar entry. */
  attention(): void;
  onClick(handler: (tag: string) => void): Unsubscribe;
}

// ── window ─────────────────────────────────────────────────────────────────

export type Platform = 'mac' | 'win' | 'linux';

/**
 * Which copy of the app this is.
 *
 * 'dev' is a run from a checkout, 'release' one the user installed. The app
 * cannot work this out for itself — the same bundle of renderer code runs in
 * both — so the host, which already decides where `userData` lives on exactly
 * this distinction, reports it.
 */
export type Build = 'dev' | 'release';

export interface WindowState {
  focused: boolean;
  fullscreen: boolean;
}

export interface WindowDriver {
  platform(): Platform;
  /**
   * Whether this window belongs to a development run or an installed app.
   *
   * Developing Atrium inside Atrium puts two identical windows on screen, and
   * mistaking the installed one for the build under test means typing into the
   * window holding your real agents. The title bar marks the dev one.
   */
  build(): Build;
  /**
   * Space to leave clear of the OS window controls, in CSS pixels.
   *
   * macOS puts traffic lights top-left, Windows and Linux put their controls
   * top-right. Asking the host means the app never sniffs a user agent.
   */
  chromeInsets(): { lead: number; trail: number };
  subscribe(handler: (state: WindowState) => void): Unsubscribe;
}

// ── workspace persistence ──────────────────────────────────────────────────

/**
 * Everything needed to put the window back the way it was.
 *
 * Note what this cannot contain: the running processes. A pseudo-terminal is
 * a child of the app, so quitting ends it. What survives is the *shape* of the
 * workspace plus each terminal's scrollback, and on restore the commands are
 * run again. Making the processes themselves outlive the app needs a detached
 * daemon — see open question O1 in docs/plan/active/03-architecture.md.
 */
export interface PersistedWorkspace {
  version: 1;
  sessions: Session[];
  activeId: string | null;
  /** Per-tab terminal history, trimmed to a budget the host can store. */
  scrollback: Record<string, string>;
}

export interface WorkspaceDriver {
  load(): Promise<PersistedWorkspace | null>;
  save(state: PersistedWorkspace): Promise<void>;
  /** How much scrollback per tab this host is willing to keep. */
  readonly scrollbackBudget: number;
}

// ── the host ───────────────────────────────────────────────────────────────

export interface Host {
  readonly name: string;
  readonly capabilities: Capabilities;
  readonly sessions: SessionDriver;
  readonly surfaces: SurfaceDriver;
  readonly files: FileDriver;
  readonly notify: NotifyDriver;
  readonly window: WindowDriver;
  readonly workspace: WorkspaceDriver;
}

/** Thrown by a driver whose capability flag is false. */
export class UnsupportedError extends Error {
  constructor(capability: keyof Capabilities) {
    super(`This host does not support "${capability}"`);
    this.name = 'UnsupportedError';
  }
}
