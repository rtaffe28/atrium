import type { SurfaceDriver, SurfaceEvent, Unsubscribe } from '../types';
import type { AtriumBridge } from './bridge';

/**
 * The slice of Electron's <webview> element this driver uses, typed by hand:
 * the renderer never imports electron.
 */
interface WebviewElement extends HTMLElement {
  src: string;
  reload(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
  getWebContentsId(): number;
}

/**
 * One per surface id, for as long as anything is mounted or subscribed.
 *
 * The entry outlives any one mount. A tab that moves between panes remounts
 * its surface while whoever subscribed to it stays subscribed, and React's
 * development mode mounts every new surface twice; in both the listeners are
 * the one thing that must survive, or they go on listening for a view that
 * no longer exists while the live one reports to nobody.
 */
interface Entry {
  /** Null between mounts. */
  view: WebviewElement | null;
  listeners: Set<(event: SurfaceEvent) => void>;
}

/**
 * Surfaces backed by Electron's <webview>.
 *
 * This is the upgrade the iframe version could never be: no X-Frame-Options,
 * no same-origin restrictions, real navigation events. The app above cannot
 * tell the difference — it hands over a container either way.
 *
 * One rule governs `src`: it is written for a navigation the user asked for,
 * never with a URL the view itself reported. Electron reloads a webview whose
 * src is assigned its own value, so echoing the page's URL back at it is a
 * reload per navigation — and a loop, for a page that lands somewhere new
 * each time it loads.
 */
export class WebviewSurfaces implements SurfaceDriver {
  private entries = new Map<string, Entry>();

  constructor(bridge: AtriumBridge) {
    // One subscription for every surface: the main process names the
    // webContents that asked, and only the view itself knows which that is.
    bridge.surfaces.onOpen((webContentsId, url) => {
      for (const entry of this.entries.values()) {
        if (!entry.view?.isConnected) continue;
        let id: number;
        try {
          id = entry.view.getWebContentsId();
        } catch {
          continue; // not attached yet
        }
        if (id !== webContentsId) continue;
        for (const listener of entry.listeners) listener({ type: 'open', url });
        return;
      }
    });
  }

  mount(id: string, container: HTMLElement, options: { url?: string }): Unsubscribe {
    const view = document.createElement('webview') as WebviewElement;
    view.className = 'surface-frame';
    // Without this the guest drops new-window requests before the main
    // process sees them. Every one is denied there and becomes a tab instead.
    view.setAttribute('allowpopups', '');
    if (options.url) view.src = options.url;

    const entry = this.entry(id);
    entry.view = view;

    // A view that has been replaced says nothing: its guest is gone, and
    // anything still arriving from it is about a page nobody is looking at.
    const emit = (event: SurfaceEvent) => {
      if (entry.view !== view) return;
      for (const listener of entry.listeners) listener(event);
    };
    // Where the page is now, and whether there is anywhere to go back or
    // forward to. Reported, not requested: the app records it and leaves it.
    const arrived = (url: string) => {
      let canGoBack = false;
      let canGoForward = false;
      try {
        canGoBack = view.canGoBack();
        canGoForward = view.canGoForward();
      } catch {
        // The guest went away under the event. The URL still happened; a
        // throw here would lose it, since nothing above hears a DOM listener.
      }
      emit({ type: 'url', url, canGoBack, canGoForward });
    };

    const onStart = () => emit({ type: 'loading', loading: true });
    const onStop = () => emit({ type: 'loading', loading: false });
    const onTitle = (e: Event) =>
      emit({ type: 'title', title: (e as unknown as { title: string }).title });
    const onNavigate = (e: Event) => arrived((e as unknown as { url: string }).url);
    // A frame inside the page changing its own hash is not the page moving.
    const onNavigateInPage = (e: Event) => {
      const { isMainFrame, url } = e as unknown as { isMainFrame: boolean; url: string };
      if (isMainFrame) arrived(url);
    };
    const onFail = (e: Event) => {
      const { errorCode, errorDescription, isMainFrame } = e as unknown as {
        errorCode: number;
        errorDescription: string;
        isMainFrame: boolean;
      };
      // -3 is ERR_ABORTED: a load cut short by the next one, which nobody
      // needs telling about. A frame inside the page failing is its own affair.
      if (errorCode === -3 || !isMainFrame) return;
      emit({ type: 'error', message: errorDescription });
    };

    view.addEventListener('did-start-loading', onStart);
    view.addEventListener('did-stop-loading', onStop);
    view.addEventListener('page-title-updated', onTitle);
    view.addEventListener('did-navigate', onNavigate);
    view.addEventListener('did-navigate-in-page', onNavigateInPage);
    view.addEventListener('did-fail-load', onFail);

    // Attached a microtask from now, not immediately. React's development
    // mode mounts a new surface, unmounts it and mounts it again in one go,
    // and a <webview> appended in that first mount creates a guest page only
    // to destroy it on the spot — Electron's own internals throw over the
    // guest that is already gone. Nothing is visible for a microtask.
    let detached = false;
    queueMicrotask(() => {
      if (!detached) container.appendChild(view);
    });

    return () => {
      detached = true;
      view.remove();
      if (entry.view === view) entry.view = null;
      this.prune(id);
    };
  }

  private entry(id: string): Entry {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { view: null, listeners: new Set() };
      this.entries.set(id, entry);
    }
    return entry;
  }

  /** Forget a surface once nothing is mounted or listening. */
  private prune(id: string) {
    const entry = this.entries.get(id);
    if (entry && !entry.view && entry.listeners.size === 0) this.entries.delete(id);
  }

  /**
   * The view for `id` once Electron has attached a guest page to it. Every
   * method but setting src throws before then, and a click on Reload in the
   * moment before a page exists is nothing to do, not an error.
   */
  private attached(id: string): WebviewElement | null {
    const view = this.entries.get(id)?.view;
    if (!view) return null;
    try {
      view.getWebContentsId();
    } catch {
      return null;
    }
    return view;
  }

  async navigate(id: string, url: string) {
    const view = this.entries.get(id)?.view;
    if (view) view.src = url;
  }

  async reload(id: string) {
    this.attached(id)?.reload();
  }

  async back(id: string) {
    this.attached(id)?.goBack();
  }

  async forward(id: string) {
    this.attached(id)?.goForward();
  }

  async toggleDevTools(id: string) {
    const view = this.attached(id);
    if (!view) return;
    if (view.isDevToolsOpened()) view.closeDevTools();
    else view.openDevTools();
  }

  subscribe(id: string, handler: (event: SurfaceEvent) => void): Unsubscribe {
    // Subscribing before mount is normal: the component wires up its
    // listener on the same render that asks for the surface.
    const entry = this.entry(id);
    entry.listeners.add(handler);
    return () => {
      entry.listeners.delete(handler);
      this.prune(id);
    };
  }
}
