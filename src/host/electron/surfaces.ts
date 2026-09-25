import type { SurfaceDriver, SurfaceEvent, Unsubscribe } from '../types';
import type { AtriumBridge } from './bridge';

interface Entry {
  view: HTMLElement & {
    src: string;
    reload(): void;
    goBack(): void;
    goForward(): void;
    getWebContentsId(): number;
  };
  listeners: Set<(event: SurfaceEvent) => void>;
}

/**
 * Surfaces backed by Electron's <webview>.
 *
 * This is the upgrade the iframe version could never be: no X-Frame-Options,
 * no same-origin restrictions, real navigation events. The app above cannot
 * tell the difference — it hands over a container either way.
 */
export class WebviewSurfaces implements SurfaceDriver {
  private entries = new Map<string, Entry>();

  constructor(bridge: AtriumBridge) {
    // One subscription for every surface: the main process names the
    // webContents that asked, and only the view itself knows which that is.
    bridge.surfaces.onOpen((webContentsId, url) => {
      for (const entry of this.entries.values()) {
        if (!entry.view || !entry.view.isConnected) continue;
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
    const view = document.createElement('webview') as Entry['view'];
    view.className = 'surface-frame';
    // Without this the guest drops new-window requests before the main
    // process sees them. Every one is denied there and becomes a tab instead.
    view.setAttribute('allowpopups', '');
    if (options.url) view.src = options.url;

    const listeners = this.entries.get(id)?.listeners ?? new Set();
    this.entries.set(id, { view, listeners });

    const emit = (event: SurfaceEvent) => {
      for (const listener of listeners) listener(event);
    };
    const onStart = () => emit({ type: 'loading', loading: true });
    const onStop = () => emit({ type: 'loading', loading: false });
    const onTitle = (e: Event) =>
      emit({ type: 'title', title: (e as unknown as { title: string }).title });
    const onNavigate = (e: Event) =>
      emit({ type: 'url', url: (e as unknown as { url: string }).url });
    const onFail = (e: Event) =>
      emit({ type: 'error', message: (e as unknown as { errorDescription: string }).errorDescription });

    view.addEventListener('did-start-loading', onStart);
    view.addEventListener('did-stop-loading', onStop);
    view.addEventListener('page-title-updated', onTitle);
    view.addEventListener('did-navigate', onNavigate);
    view.addEventListener('did-navigate-in-page', onNavigate);
    view.addEventListener('did-fail-load', onFail);

    container.appendChild(view);

    return () => {
      view.remove();
      const current = this.entries.get(id);
      if (current?.view === view) this.entries.delete(id);
    };
  }

  async navigate(id: string, url: string) {
    const entry = this.entries.get(id);
    if (entry) entry.view.src = url;
  }

  async reload(id: string) {
    this.entries.get(id)?.view.reload();
  }

  async back(id: string) {
    this.entries.get(id)?.view.goBack();
  }

  async forward(id: string) {
    this.entries.get(id)?.view.goForward();
  }

  subscribe(id: string, handler: (event: SurfaceEvent) => void): Unsubscribe {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { view: null as never, listeners: new Set() };
      this.entries.set(id, entry);
    }
    entry.listeners.add(handler);
    return () => entry.listeners.delete(handler);
  }
}
