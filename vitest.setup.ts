import { vi } from 'vitest';

// xterm needs canvas/WebGL, which jsdom does not have. The terminal's rendering
// is not what these tests are about — the drag arbitration around it is.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    write() {}
    dispose() {}
    attachCustomKeyEventHandler(handler: unknown) {
      (globalThis as Record<string, unknown>).__xtermKeyHandlers ??= [];
      ((globalThis as Record<string, unknown>).__xtermKeyHandlers as unknown[]).push(handler);
    }
    onData() {
      return { dispose() {} };
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class {} }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

// jsdom reports every element as a zero-size rect, so hit-testing would always
// miss. Lay the window out by hand instead: this mirrors the real CSS and
// doubles as a record of the geometry the drop zones assume.
export const LAYOUT = {
  window: { width: 1440, height: 900 },
  titlebar: 38,
  sidebar: 288,
  tabbar: 34,
};

Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
  const el = this as HTMLElement;
  const { width, height } = LAYOUT.window;
  const workspaceLeft = LAYOUT.sidebar;
  const workspaceTop = LAYOUT.titlebar;

  const rect = (left: number, top: number, w: number, h: number) =>
    ({
      left, top, width: w, height: h,
      right: left + w, bottom: top + h, x: left, y: top,
      toJSON: () => ({}),
    }) as DOMRect;

  if (el.classList.contains('sidebar')) {
    return rect(0, workspaceTop, LAYOUT.sidebar, height - workspaceTop);
  }

  // Panes divide the workspace evenly; enough for two-pane arbitration tests.
  const panes = [...document.querySelectorAll('.pane')];
  const paneIndex = panes.indexOf(el.closest('.pane') as Element);
  const paneCount = Math.max(1, panes.length);
  const paneWidth = (width - workspaceLeft) / paneCount;
  const paneLeft = workspaceLeft + Math.max(0, paneIndex) * paneWidth;

  if (el.classList.contains('pane')) {
    return rect(paneLeft, workspaceTop, paneWidth, height - workspaceTop);
  }
  if (el.classList.contains('tabbar')) {
    return rect(paneLeft, workspaceTop, paneWidth, LAYOUT.tabbar);
  }
  if (el.classList.contains('pane-body')) {
    return rect(
      paneLeft,
      workspaceTop + LAYOUT.tabbar,
      paneWidth,
      height - workspaceTop - LAYOUT.tabbar,
    );
  }
  if (el.hasAttribute('data-tab-id')) {
    const bar = el.closest('.tabbar');
    const siblings = bar ? [...bar.querySelectorAll('[data-tab-id]')] : [el];
    const i = siblings.indexOf(el);
    return rect(paneLeft + 6 + i * 120, workspaceTop + 4, 120, 26);
  }
  return rect(0, 0, 0, 0);
};

if (!window.matchMedia) {
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
}

// jsdom has no ResizeObserver and never lays anything out, so a no-op is
// faithful: nothing here ever changes size.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
}
