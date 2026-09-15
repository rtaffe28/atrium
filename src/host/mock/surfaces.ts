import type { SurfaceDriver, SurfaceEvent, Unsubscribe } from '../types';

interface Entry {
  frame: HTMLIFrameElement;
  listeners: Set<(event: SurfaceEvent) => void>;
  history: string[];
  cursor: number;
}

/**
 * Surfaces backed by iframes.
 *
 * Any site sending X-Frame-Options: DENY — most of them — refuses to render
 * here. That is a browser limitation, not a design one: under Electron this
 * driver is swapped for one backed by <webview>, which has no such
 * restriction, and the app above never learns the difference. Local dev
 * servers, the actual use case, iframe fine.
 */
export class IframeSurfaces implements SurfaceDriver {
  private entries = new Map<string, Entry>();

  mount(id: string, container: HTMLElement, options: { url?: string }): Unsubscribe {
    const frame = document.createElement('iframe');
    frame.className = 'surface-frame';
    frame.setAttribute('title', 'Embedded page');
    if (options.url) frame.src = options.url;

    const entry: Entry = {
      frame,
      listeners: this.entries.get(id)?.listeners ?? new Set(),
      history: options.url ? [options.url] : [],
      cursor: options.url ? 0 : -1,
    };

    const onLoad = () => this.emit(id, { type: 'loading', loading: false });
    frame.addEventListener('load', onLoad);

    container.appendChild(frame);
    this.entries.set(id, entry);
    if (options.url) this.emit(id, { type: 'loading', loading: true });

    return () => {
      frame.removeEventListener('load', onLoad);
      frame.remove();
      // Listeners outlive the mount: a tab that moves between panes remounts
      // its surface but keeps whoever was subscribed to it.
      const current = this.entries.get(id);
      if (current?.frame === frame) this.entries.delete(id);
    };
  }

  private emit(id: string, event: SurfaceEvent) {
    for (const listener of this.entries.get(id)?.listeners ?? []) listener(event);
  }

  private go(id: string, url: string, record: boolean) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.frame.src = url;
    if (record) {
      entry.history = [...entry.history.slice(0, entry.cursor + 1), url];
      entry.cursor = entry.history.length - 1;
    }
    this.emit(id, { type: 'loading', loading: true });
    this.emit(id, { type: 'url', url });
    this.emit(id, { type: 'title', title: url.replace(/^https?:\/\//, '').split('/')[0] });
  }

  async navigate(id: string, url: string) {
    this.go(id, url, true);
  }

  async reload(id: string) {
    const entry = this.entries.get(id);
    if (entry && entry.cursor >= 0) this.go(id, entry.history[entry.cursor], false);
  }

  async back(id: string) {
    const entry = this.entries.get(id);
    if (!entry || entry.cursor <= 0) return;
    entry.cursor -= 1;
    this.go(id, entry.history[entry.cursor], false);
  }

  async forward(id: string) {
    const entry = this.entries.get(id);
    if (!entry || entry.cursor >= entry.history.length - 1) return;
    entry.cursor += 1;
    this.go(id, entry.history[entry.cursor], false);
  }

  subscribe(id: string, handler: (event: SurfaceEvent) => void): Unsubscribe {
    let entry = this.entries.get(id);
    if (!entry) {
      // Subscribing before mount is normal: the component wires up its
      // listener on the same render that asks for the surface.
      entry = { frame: null as never, listeners: new Set(), history: [], cursor: -1 };
      this.entries.set(id, entry);
    }
    entry.listeners.add(handler);
    return () => entry.listeners.delete(handler);
  }
}
